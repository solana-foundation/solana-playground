## Context

SF#106 put the built-in wallet behind `WalletSignerProvider`
(`client-v2/src/utils/wallet/signer-provider.ts`) and ran project code in an
opaque-origin sandbox that asks the page to sign. The page still holds the
keys: `PgWallet.accounts[i].kp` in memory, the `pg-wallet` IndexedDB record,
the Setup and Add dialogs' `useState(Keypair.generate)`, `PgWallet.import`
parsing a key file in the page, `PgWallet.export` and `getKeypairBytes`
reading bytes from the provider. An opaque-origin frame cannot hold the keys:
without `allow-same-origin` it has no storage. So the keys need a real origin.

Decided on the 7 Nov call (Slava, Sergey Prokhorov; HOO-2680): a hidden iframe
on its own subdomain, CSP-locked; `postMessage`, not BroadcastChannel; the API
is sign a transaction, sign a message, return the public key, no batch; import
behaves like creating a wallet inside the iframe; export only if the key never
reaches the app page, else no export. Target after Breakpoint: the built-in
wallet becomes a throwaway auxiliary key.

## Goals / Non-Goals

**Goals:**

- No store of the app's origin and no app-page memory holds key bytes once the
  key origin is configured and the move is done.
- `run`, `test`, deploy, send, fund and the tutorial flows sign as before.
- Existing users keep every key.

**Non-Goals:**

- Approval prompts per sign request.
- The program keypair (`PgProgramInfo.kp`): a deploy key, not a wallet key.
- An async signer for the WASM CLIs (`wasm/` is upstream's).
- The throwaway-wallet model.

## Decisions

Decisions marked **(my call)** were made in this change, with Slava away; the
rest come from the 7 Nov call.

- **The key page is a third entry of the same build (my call).**
  `wallet-keys.html` and its script are built beside `index.html` and
  `runtime.html`, as the sandbox is (`craco.config.js` `addSandboxEntry`). The
  entry imports only `@noble/ed25519` and its own modules: no web3.js, no app
  module, no shared chunk. The same Vercel deployment serves it on a second
  domain, so there is no second project to build and keep in step. A second
  project would isolate the key origin's files further; it costs a pipeline
  and a release that can drift from the app's protocol version.
- **The app never runs on the key origin (my call).** A `vercel.json`
  redirect sends every path but `/wallet-keys.html` and
  `/static/js/wallet-keys*` to `/wallet-keys.html` on a host whose first
  label is `wallet-keys` (for example `wallet-keys.playground.solana.com`).
  It is a redirect because Vercel runs redirects before its files and
  functions, and rewrites only after them: as a rewrite, `index.html`, the
  app's scripts and `/api` would still answer on that host. Without the rule
  an app XSS opened on the key origin would read the keys.
- **The key origin is same-site with the app in production.** A subdomain of
  the app's site keeps the frame's storage unpartitioned and under the same
  browser retention rules as the app's own (Safari's included). A preview on
  `*.vercel.app` is cross-site to any other host there, so its frame storage
  is partitioned per top-level site; it works, but a preview's keys are its
  own.
- **The key origin comes from `REACT_APP_WALLET_KEY_ORIGIN`.** Unset, the
  build keeps the `local` provider: production stays on SF#106's behaviour
  until the domain exists, and nothing breaks before it does. Set, the
  key-origin provider is the default. The value `loopback` (development and
  e2e) means the same port on the other loopback host: an app on
  `http://localhost:<port>` uses `http://127.0.0.1:<port>`, and the reverse.
  One dev server, two origins, no second port to allocate per worktree
  **(my call; the ticket said a second port)**.
- **The key page answers one app origin.** It is built with the app origin
  it serves (`REACT_APP_WALLET_APP_ORIGIN`, or the loopback pair), checks
  `event.origin` on the handshake, and refuses anything else. Its CSP header
  adds `frame-ancestors` with the same origins. Its CSP is `default-src
  'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src
  'none'; form-action 'none'; base-uri 'none'`.
- **The channel is the sandbox's handshake with an origin check.** The page
  makes the hidden frame (`width/height 0`, `aria-hidden`, off the tab
  order), waits for `{type: "ready"}` from `frame.contentWindow` at the key
  origin, and hands it one port of a `MessageChannel`. Every later message
  goes over the port. The handshake is bounded (10 s); past it the wallet is
  `unavailable`.
- **The API.** Requests carry an `id`; replies carry the same `id` and a
  result or an error message:
  - `accounts` → the base58 public keys the key page holds.
  - `create` → makes a key, keeps it in the frame's memory as a draft, returns
    its public key. `keep(publicKey)` stores a draft; a draft is dropped when
    the frame unloads. The Setup and Add dialogs need it: they offer the key
    file before the account is added.
  - `sign(publicKey, kind, bytes)`: `kind` is `transaction` (the serialized
    message) or `message`; the reply is the 64-byte signature. A `message`
    whose bytes parse as a transaction message is refused, so a message
    signature is never a transaction signature.
  - `forget(publicKey)` removes a stored key.
  - `adopt(keys)` takes 64-byte keys moved from the page, stores them, reads
    them back and returns the public keys now held.
  No reply carries key bytes.
- **The key page stores keys by public key** in its own IndexedDB
  (`pg-wallet-keys`), under a Web Lock, because several app tabs each embed
  a frame. Names, order and the current account stay in the page's record:
  they are not secret, and the UI needs them synchronously.
- **The page's account record is `{ name, publicKey }` (my call).** The
  page derives everything it did from `kp` (dedupe, `publicKeyOf`) from
  `publicKey` instead. Under the `local` provider the record keeps `kp`, as
  today; the key-origin provider reads only `publicKey`.
- **The move is copy, confirm, then drop.** Under the wallet's existing
  cross-tab lock: read the page record, `adopt` every key, compare the
  returned public keys with the record's, then write the record without
  `kp` and clear `localStorage['wallet']` and the set-aside copies. A key the
  frame did not confirm keeps the old record whole. A record that already
  has no `kp` needs no move.
- **Page wallets reuse the sandbox's signer.** The key-origin provider is
  `sandboxSignerProviderWith(keyFrame.sign)` under a new name: wallets with a
  keypair-shaped `keypair` whose `secretKey` throws, and `signTransaction` /
  `signMessage` that send the message bytes out and splice the signature in.
  The project-code sandbox keeps asking the page, which now asks the key
  page.
- **Import and export are a visible panel of the key page (my call on the
  look).** `wallet-keys.html#panel/import` and `#panel/export/<publicKey>`
  render one button each, in the design system's secondary button look
  (theme colours passed in the fragment), inside the dialogs where the
  buttons are today. Import reads the file inside the key origin, stores the
  key as a draft and posts its public key to the page; the page adds the
  account with `keep`. Export downloads from a `blob:` URL of the key origin
  (`allow-downloads` on the frame). No key file passes through the app page.
- **The WASM CLIs refuse, with a reason.** Under the key-origin provider
  `getKeypairBytes` throws "The built-in wallet's key is kept on its own
  origin, so the solana, spl-token and anchor commands cannot sign with it.
  Connect a wallet, or use the Deploy button." (my call on the wording).
  Changing the Rust signers is its own ticket.

## Risks / Trade-offs

- [The key domain does not exist yet] → the build reads it from an env
  variable and falls back to the `local` provider; production changes only
  when the domain and the variable are set.
- [A build that loses the variable after users moved] → their page record
  has no keys; the wallet loads `unavailable`, never Setup, so nothing is
  overwritten, and setting the variable back restores it.
- [The key page and the app drift apart] → one build serves both, and the
  handshake carries a protocol version; a mismatch reads as `unavailable`.
- [The WASM CLIs lose the built-in wallet] → a clear error and a ticket for
  an async signer; most users sign through the UI.
- [Cross-site previews partition the frame's storage] → accepted: a preview
  is a test bed.

## Migration Plan

Ship with the variable unset in production: no user-visible change. Set it on
previews and locally (`loopback`) to test. When the domain exists, add it to
the Vercel project, set both variables in production, and the next load moves
each user's keys. Rollback: unset the variable and redeploy; moved users read
`unavailable` until it is set again, and the keys stay in the key origin.

## Open Questions

- Who creates the key domain and adds it to the Vercel project (Slava).
- Whether the WASM CLIs may stay without the built-in wallet until their own
  ticket (Slava / Sergey).
