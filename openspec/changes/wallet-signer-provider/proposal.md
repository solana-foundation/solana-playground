## Why

The built-in wallet's secret keys sit in the page, and five places read them
directly: the wallet object (`PgWallet.create`) with its signing methods,
`pg.wallet.keypair` handed to project code, the Anchor `payer`, the key file
export and `PgWallet.getKeypairBytes` for the WASM CLIs (HOO-1717). The call
with Sergey on 3 Nov chose a sandboxed iframe that signs over `postMessage`
as the place the keys should end up. That move needs one seam every key use
passes through. This change builds the seam, step 1 of two, and keeps the
current behaviour as its default; step 2, an iframe provider made the
default, has its own ticket.

## What Changes

- A `WalletSignerProvider` interface holds the accounts' keys and signs with
  them. It addresses an account by its public key: `walletFor({ name,
  publicKey })` returns the wallet (public key, name, signing methods), and
  `secretKeyFor(publicKey)` returns a copy of the 64 key bytes for the key
  file export and the WASM CLIs.
- The `local` provider, the default, keeps the keys in the page as today and
  still gives every wallet its `keypair`, so `tx.sign(pg.wallet.keypair)` in
  the hello-solana tutorial, the native template's test and old shared
  projects work unchanged.
- `PgWallet.create`, `PgWallet.export`, `PgWallet.getKeypairBytes` and the
  duplicate check in `PgWallet.add` go through the provider or read only the
  public key. `PgWallet.setSignerProvider` replaces the provider.
- The local provider signs a v0 versioned transaction. The old check read
  `tx.version`, which is `0` there, and sent it to `partialSign`, which a
  versioned transaction lacks.
- The wallet's storage (`wallet-storage`, HOO-1717 step 1's IndexedDB move)
  is unchanged. No telemetry events are added, renamed or removed.

## Capabilities

### New Capabilities

- `wallet-signing`: how the built-in wallet's keys are reached for signing,
  export and the WASM CLIs, and what project code keeps.

### Modified Capabilities

None.

## Impact

- `client-v2/src/utils/wallet/`: new `signer-provider.ts`; `wallet.ts` and
  `types.ts` (the Playground wallet type is exported as `PlaygroundWallet`).
- No change to `pg.wallet`'s shape, the `Wallet` type, the WASM bindings or
  the server.
