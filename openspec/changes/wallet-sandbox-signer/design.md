# Design

## Context

See proposal.md for why. Today `run` and `test` (`utils/js-runtime/js-runtime.ts`)
execute project code in a hidden same-origin `about:blank` iframe and hand it
live objects from the page: `pg` (built by `_getPg`, with `pg.wallet` from
`PgWallet.current`, whose `keypair` holds the secret key), the page's own
`web3`, `anchor`, `mocha`, `Buffer` and the rest of `supported-packages.json`,
and a `console` that prints to `PgTerminal`. A substring blacklist
(`window`, `document`, `globalThis`, ...) is the only barrier, and it is not a
security boundary. TypeScript is transpiled in the page. Mocha is the page's
singleton, polled through `_state`. RPC uses the page's `Connection`, whose
`fetch` Playnet replaces with in-page WASM answers.

The app is cross-origin isolated (COEP `require-corp`, COOP `same-origin`, in
`craco.config.js` and `vercel.json`). There is one copy of `@solana/web3.js`
(1.98.4).

HOO-1717 step 1 (this PR) put every use of a key behind `WalletSignerProvider`
(`utils/wallet/signer-provider.ts`). This change adds the provider that lives
in the sandbox. The interface does not change.

## Goals / Non-Goals

**Goals:**

- Project code cannot read a built-in wallet key, the page's storage or the
  page itself, while every documented way of signing keeps working.
- One runtime path for `run` and `test`; no second code path to keep in sync.

**Non-Goals:**

- Approval prompts for sign requests.
- Isolating deploy, the WASM CLIs or the key file export: they stay in the
  page on the local provider.
- Stopping a running script by tearing down its frame.

## Decisions

### 1. A sandboxed frame on its own build entry

`run` and `test` load `runtime.html` in an iframe with
`sandbox="allow-scripts"` and nothing else, so its origin is opaque: no
storage, no `parent` access, no same-origin DOM. `runtime.html` is a second
webpack entry (`HtmlWebpackPlugin` with its own chunk) that bundles the
packages project code may import, mocha and the sandbox half of the runtime.
The frame is created once and kept, as today, and reset between runs by
reloading it.

Alternatives: `srcdoc` or a `blob:` URL would inherit the page's origin under
some browsers and its COEP, and cannot load the bundle without inlining it; a
separate domain needs infrastructure we do not have before 11 Nov.

### 2. One MessageChannel, opened by the page

An opaque origin can only be posted to with target `"*"`, so the page sends one
`MessageChannel` port in its first message after the frame's `load`, and both
sides talk only on that port afterwards. The page ignores `window` messages
after the handshake and checks `event.source === frame.contentWindow` for the
handshake itself. Messages are a small typed protocol (`run`, `output`,
`result`, `end`, `sign`, `rpc`, `ready`), defined in one module both entries
import, so the two halves cannot drift.

### 3. What crosses, and what never does

Into the sandbox: the code, already transpiled in the page (the transpiler
stays where it is, so the sandbox bundle stays small), the IDL and
`PROGRAM_ID`, the RPC endpoint and commitment, and for each connected wallet
its name and public key. Out of it: console lines, mocha results, the end of
the run, sign requests and RPC requests. No message carries key bytes; a unit
test asserts it over the protocol's types and an e2e asserts it at runtime.

### 4. The sandbox signer provider

Inside the sandbox, `walletFor` returns a wallet whose `signTransaction`,
`signAllTransactions` and `signMessage` post a `sign` request (serialized
message bytes plus the signer's public key) and resolve with the signature
the page returns. The page signs with its local provider, or with the
connected standard wallet for `pg.wallets.<name>`, and answers. `secretKeyFor`
throws. `pg.wallet.keypair` is a keypair-shaped object
(`Object.create(Keypair.prototype)`) with the real `publicKey` and a
`secretKey` getter that throws an error naming `pg.wallet.signTransaction`
and `pg.wallet.signMessage`.

### 5. Synchronous `tx.sign(keypair)` through placeholders

`Transaction.sign`, `partialSign` and `VersionedTransaction.sign` are
synchronous, and hello-solana does `tx.sign(pg.wallet.keypair)` then
`sendRawTransaction(tx.serialize())`. The sandbox patches its own web3 copy:

- signing with a sandbox keypair writes a 64-byte placeholder signature into
  that signer's slot and sends the sign request at once;
- the patched `sign` returns a promise that resolves once every real
  signature is in, so `await tx.sign(...)` gives a fully signed transaction
  and code that does not await is unaffected;
- `serialize` skips signature verification only while a slot holds a known
  placeholder;
- the sandbox's JSON-RPC transport finds known placeholders in the wire bytes
  of `sendTransaction` and `simulateTransaction` requests, waits for their real
  signatures, splices them in and then sends, which covers every `Connection`
  and every send method without patching each one; a resolved signature is also
  written back into the transaction object.

So `sendAndConfirmTransaction(conn, tx, [pg.wallet.keypair])`, anchor's
`provider.wallet.payer`, `.signers([payer])` and the spl-token helpers keep
working: they all sign first and send later. Reading `tx.signature` right
after a synchronous `sign` gives the placeholder until the transaction is sent
or the promise resolves.

Alternatives: a synchronous round trip (`Atomics.wait` on a
`SharedArrayBuffer`) blocks the sandbox's event loop, which the page's answer
needs, and is unavailable on the opaque-origin frame's thread anyway; dropping
`tx.sign(pg.wallet.keypair)` breaks the tutorial, the native template and old
shared projects, which Sergey's call ruled out.

### 6. RPC through the page

Before web3 loads, the sandbox sets `globalThis.fetch` to a stand-in that
posts JSON-RPC bodies as `rpc` requests; the page runs them through its own
`window.fetch`, so Playnet's override answers them exactly as today and the
sandbox's `null` origin never meets CORS. The page refuses a request to its own
origin and sends no credentials. Every other fetch, and any websocket, leaves
from the sandbox's opaque origin, so project code can still reach the network.

Websocket subscriptions are not bridged. `confirmTransaction` waits on a
subscription, so the sandbox patches it to poll; a subscription against Playnet
from project code fails, and `docs/assistant-context.md` says so.

### 7. Headers

Under COEP `require-corp` an opaque-origin frame's requests are cross-origin.
`runtime.html` is served with COEP `require-corp`, and `/static/*` with
`Cross-Origin-Resource-Policy: cross-origin`, in `vercel.json` and in the dev
server's headers. The page's own documents keep their headers.

### 8. No in-page fallback

The old in-page runtime is removed, not kept behind a developer override: a
second path would bypass the isolation this change exists for and would rot
untested. Rollback is a revert of this PR. (Our call; the HOO-2600 draft kept
it.)

### 9. Mocha inside the sandbox

Mocha runs in the sandbox with a reporter that posts each line and the final
counts on the port; the page prints them with the colouring the current
`console.log` override applies. The `_state` polling goes away: the sandbox
posts `end`.

## Risks / Trade-offs

- [Code that reads `secretKey` breaks] → the error names the replacement;
  `docs/assistant-context.md` explains it so the assistant can fix such code.
- [The web3 patch depends on web3 1.x internals] → web3 is pinned by the
  lockfile; unit tests cover each patched method, so an upgrade that moves
  them fails CI.
- [A placeholder leaks into a transaction that is never sent through the
  transport (e.g. serialized and posted by hand)] → a signature that was never
  sent is warned about in the terminal when the run ends, since a warning in
  `serialize` would fire on every hello-solana run; `await tx.sign(...)` is the
  documented safe form.
- [The sandbox bundle duplicates web3, anchor and mocha] → it is a lazily
  loaded entry, fetched on the first `run`; the bundle row is explained in the
  PR.
- [COEP blocks a sandbox asset in some browser] → the 15-second load timeout
  reports it in the terminal instead of hanging.

- [A standard wallet changes the transaction it signs] → the page verifies each
  signature it returns and refuses one that does not match the request.
- [Browsers other than Chromium are untested for COEP plus an opaque origin] →
  the e2e suite runs Chromium only; the 15-second timeout reports a failure, and
  a manual check in Firefox and Safari goes in the PR.
- [Metaplex `keypairIdentity(pg.wallet.keypair)` in the spl-token-vault tutorial
  fails if it signs messages with `secretKey`] → transaction signing is expected
  to work; a manual run of that tutorial goes in the PR.

## Migration Plan

No data migration. Deploy is the normal one; the new headers ship in the same
`vercel.json`. Rollback: revert the PR; nothing persistent depends on it.
