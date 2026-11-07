# Tasks

Plan: [plans/1-wallet-cli-signing.md](plans/1-wallet-cli-signing.md)

All tasks are HOO-2723.

## 1. Deferred signing in the WASM client

- [x] 1.1 `solana-client`: deferred-signer registry (`set`/`clear`) and filling
  marker slots in `send_transaction_with_config`; host `cargo test` covers
  "fills only the registered key's marker slot", "leaves other signers",
  "no registry, unchanged"
- [x] 1.2 `solana-playground-utils`: `PgWalletSigner` (marker, wallet pubkey),
  JS bindings `getPublicKeyBytes` and async `signTransactionMessage`, feature
  detection, and a `wallet_signer()` helper that registers the deferred signer
  or falls back to the key bytes (depends on 1.1); host `cargo test` for the
  marker and `try_sign` passing `is_signed`
- [x] 1.3 `solana-cli`, `spl-token-cli`, `anchor-cli`: use `wallet_signer()`;
  clear the registry at the end of every run; check `simulate_transaction`
  callers for `sig_verify: true` (depends on 1.2); `cargo check
  --target wasm32-unknown-unknown` for the three crates

## 2. client-v2

- [x] 2.1 `PgWallet.getPublicKeyBytes` and `PgWallet.signTransactionMessage`
  through the signer provider; vitest: the exact message bytes signed under
  the local provider without `secretKeyFor`, the wallet's `signTransaction`
  path, and the refusals (no wallet, another wallet, unsigned, wrong bytes);
  the key page itself is covered by the provider tests and by 3.1
- [x] 2.2 Pre-check: refuse only `--sign-only` under the key origin; drop the
  `anchor idl` list; update `key-read.test.ts`

## 3. Verify

- [ ] 3.1 `yarn run check`; CI's `wasm` job builds the real packages; devnet
  `solana transfer` and `spl-token transfer` with the key origin on, against
  CI's real packages or the preview (depends on 1.3, 2.1)
