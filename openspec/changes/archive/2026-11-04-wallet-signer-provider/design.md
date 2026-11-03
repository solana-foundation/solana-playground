## Context

HOO-1717's step 1 moved the wallet's state to IndexedDB. Project code still
runs in a same-origin iframe and reads `pg.wallet.keypair`, so the key is in
reach of every project. Sergey chose (3 Nov) a sandboxed iframe that holds the
keys and signs over `postMessage`; a non-extractable WebCrypto key was
rejected. The move is built in two steps, both before Breakpoint.

## Goals / Non-Goals

**Goals:**

- One seam, `WalletSignerProvider`, that every use of an account's key passes
  through.
- The current behaviour as the first, default provider, byte for byte.
- An interface an iframe provider can implement without the callers changing.

**Non-Goals:**

- The iframe provider and making it the default (step 2, its own ticket).
- Changing `pg.wallet`, the `Wallet` type or what project code may read.

## Decisions

- **The provider addresses an account by its public key, not by its key
  bytes.** `walletFor` takes `{ name, publicKey }` and `secretKeyFor` a public
  key, so a provider that keeps the keys elsewhere needs nothing from the
  page but the address. The local provider looks the key up in
  `PgWallet.accounts` through a lookup it is built with
  (`localSignerProviderWith(keyFor)`), which keeps `signer-provider.ts` free
  of the wallet module.
- **`walletFor` returns the whole Playground wallet, `keypair` included.**
  The `Wallet` type stays as it is; the local provider fills `keypair`, and
  step 2 decides what an iframe provider gives project code in its place.
- **`secretKeyFor` stays synchronous.** `getKeypairBytes` is a synchronous
  `wasm_bindgen` import the CLIs call; making it async changes the Rust side.
  Step 2 settles how the export and the CLIs reach a key held in an iframe.
- **`PgWallet.setSignerProvider` is the selection point.** A wallet already
  derived keeps the provider it was made with, so a provider is set before
  the wallet loads.
- **A v0 transaction is told apart by the `version` field, not its value.**
  `"version" in tx` holds for a versioned transaction of any version; a
  legacy `Transaction` has no such field.

## Risks / Trade-offs

- [The interface may not fit the iframe provider] → it carries only what an
  asynchronous signer needs (public key in, signatures out); the synchronous
  `secretKeyFor` and `keypair` are named as step 2's open points above.
- [A provider swapped after load would be ignored by the current wallet] →
  documented on `setSignerProvider`; step 2 sets it at boot.
