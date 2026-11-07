## Why

SF#106 (HOO-1717, HOO-2600) keeps the built-in wallet's keys out of
`localStorage` and out of project code, but the keys still sit in the app
page: in the page origin's IndexedDB `pg-wallet` and in memory as
`PgWallet.accounts[i].kp`. An XSS, a compromised app dependency or an extension
running in the page can read them. The 7 Nov call (Slava and Sergey Prokhorov)
settled the fix: the keys live in a hidden iframe on an origin of their own,
locked down by a Content Security Policy, which signs over `postMessage`. Slava
marked it urgent, before Breakpoint (HOO-2680).

## What Changes

- **A key page on its own origin.** `wallet-keys.html` is a third webpack
  entry beside the app and the project-code sandbox, with no code shared with
  the app. Loaded on the key origin, it holds the accounts' 64 key bytes in
  that origin's IndexedDB and answers over a private `MessageChannel`: list the
  public keys it holds, make a key, sign a transaction message, sign a message,
  forget a key, take in keys moved from the page. Batch signing is not in the
  API. It answers only the app origin it was built for.
- **The key-origin signer provider becomes the default** wherever the build
  names a key origin (`REACT_APP_WALLET_KEY_ORIGIN`). Wallets it builds sign
  through the key page and carry a keypair-shaped `keypair` whose `secretKey`
  throws, the same object the sandbox gives project code. A build without the
  variable keeps the `local` provider as it is today.
- **The page's wallet record holds no key bytes.** An account is stored as its
  name and public key. Under the key-origin provider no store of the app's
  origin, IndexedDB or `localStorage`, holds key bytes.
- **One-time move.** On the first load with a key origin, the page sends every
  account's key to the key page, which stores it, reads it back and returns the
  public keys it holds. Only then does the page rewrite its record without
  keys. Any failure leaves the old record as it is, and the next load tries
  again.
- **New, import and export happen inside the key origin.** A new account's key
  is made in the key page. Import and export are a small visible panel of the
  key page inside the wallet's dialogs: its own "Import key file" input and
  "Save keypair" button, so a key file is read and written by the key
  origin and never reaches the app page.
- **The WASM CLIs** (`solana`, `spl-token`, `anchor`), which sign in Rust with
  the key's bytes read synchronously, say they cannot use a built-in wallet
  whose key is held on its own origin. `wasm/` is upstream's and out of scope;
  an async signer for them is its own ticket.
- **An unreachable key origin** (blocked, offline, never answers within the
  time limit) puts the wallet in the existing `unavailable` state; nothing is
  overwritten.
- **Deploy headers.** The key page is served with its own CSP
  (`default-src 'none'`, its own script only, `frame-ancestors` the app
  origins) and the COEP/CORP headers an embedded page of a `require-corp` app
  needs. On a host whose first label is `wallet-keys`, every other path is
  refused, so the app itself never runs on the key origin.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wallet-signing`: the key-origin provider, its API, its default, and what
  the export and the CLIs do under it.
- `wallet-storage`: the page's record without key bytes, the one-time move,
  and the unreachable key origin.

## Impact

- `client-v2/src/utils/wallet/` (provider, wallet, storage), a new
  `client-v2/src/utils/wallet/key-origin/` (page side and key page), the wallet
  dialogs in `client-v2/src/components/Wallet/`, `craco.config.js`,
  `vercel.json`.
- Deploy: the key origin is a second domain on the same Vercel project. Until
  it exists, production keeps the `local` provider. Who creates it is open
  with Slava.
- Out of scope: approval prompts per sign request; the program keypair
  (`PgProgramInfo.kp`), which is not a wallet key; changing the WASM CLIs.
