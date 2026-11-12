# Proposal

## Why

Project code, including a shared project someone else wrote, runs in a
same-origin iframe today and gets `pg.wallet.keypair` as a live object, so
any script can read the built-in wallet's secret key, and the page's
IndexedDB and localStorage along with it. HOO-1717 put every use of the key
behind a signer provider. This change, step 2 of the decision from the
3 Nov call (HOO-2600), adds the provider that keeps the key out of project
code and makes it the default.

## What Changes

- `run` and `test` execute project code in a sandboxed iframe with an opaque
  origin. It cannot reach the page, its storage, or the wallet's key.
- Inside the sandbox, `pg.wallet` comes from a new signer provider that signs
  over postMessage. The page signs each request with the local provider, and
  the secret key never crosses into the sandbox.
- `pg.wallet.keypair` stays a keypair-shaped object with the real public
  key. `tx.sign(pg.wallet.keypair)`, `sendAndConfirmTransaction(…,
  [pg.wallet.keypair])`, anchor's `provider.wallet.payer` and
  `.signers([payer])` keep working: the real signature is put in before the
  transaction leaves the sandbox.
- **BREAKING** for project code that reads the key bytes
  (`pg.wallet.keypair.secretKey`, `Keypair.fromSecretKey(...)` over them,
  `nacl.sign.detached(msg, kp.secretKey)`): it gets an error that names
  `pg.wallet.signMessage` and `pg.wallet.signTransaction` instead.
- **BREAKING** for project code that uses more of a standard wallet than it
  signs with: under `pg.wallets`, and as `pg.wallet` when it is current, a
  standard wallet exposes its name, public key, `signTransaction`,
  `signAllTransactions` and `signMessage` only, not the rest of the wallet
  object the in-page runtime handed over.
- The packages project code can import (web3.js, anchor, mocha and the rest
  of `supported-packages.json`) load inside the sandbox from a second build
  entry. RPC calls go through the page, so Playnet keeps working.
- Static assets are served with `Cross-Origin-Resource-Policy: cross-origin`,
  so the opaque-origin sandbox can load them under the app's
  cross-origin isolation (COEP `require-corp`). User-visible effect: none,
  beyond `run` and `test` working.
- The in-page runtime is removed; there is no path that runs project code
  in the page.
- Telemetry: no product events are added, renamed or removed. Sandbox
  failures (load timeout, a refused sign request) are logged through
  `shared/lib/logger`.

## Capabilities

### New Capabilities

- `project-code-sandbox`: where and how `run` and `test` execute project
  code. Covers the isolation guarantees, which globals and packages project
  code gets, output to the terminal, test results, and RPC that includes
  Playnet.

### Modified Capabilities

- `wallet-signing`: the default provider for project code becomes the
  sandbox provider. `pg.wallet.keypair` keeps its signing uses but no longer
  yields key bytes.

## Impact

- Code: `client-v2/src/utils/js-runtime/` (the runtime is split into a
  parent half and a sandbox entry), `client-v2/src/utils/wallet/` (the
  sandbox signer provider and the parent's sign bridge),
  `client-v2/craco.config.js` (a second entry and its HTML page, and dev
  server headers), `client-v2/vercel.json` (CORP header).
- Tests: unit tests for the provider, the placeholder splice and the message
  bridge. An e2e that a sandboxed script cannot read the key. The existing
  signing, deploy and hello-solana e2e keep passing.
- Docs: `docs/assistant-context.md` explains the `secretKey` error.
- Out of scope: approval prompts for sign requests (project code still signs
  without asking, as today). Moving the key out of the page itself
  (HOO-2426 does this for the model key). Stopping a running script by
  removing its iframe (the stop spec is unchanged). Exports to a local
  project, which rewrite `pg.wallet.keypair` to a file keypair and do not
  run in the sandbox. Deploy, the CLIs and the key file export, which stay
  in the page on the local provider.
