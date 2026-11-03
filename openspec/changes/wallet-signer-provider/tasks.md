## 1. Signer provider

- [x] 1.1 `WalletSignerProvider` and the local provider in `utils/wallet/signer-provider.ts`, with in-source tests (sign legacy and v0, sign a message, unknown public key, key copy)
- [x] 1.2 `PgWallet.create`, `export`, `getKeypairBytes` and `add` through the provider; `PgWallet.setSignerProvider`
- [x] 1.3 e2e `wallet-signing: Project code signs with pg.wallet.keypair`
