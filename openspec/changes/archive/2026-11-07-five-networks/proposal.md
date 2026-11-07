# Proposal

## Why

[HOO-2488](https://linear.app/solana-fndn/issue/HOO-2488) cut Settings › Network to Devnet and Mainnet, following Spec 07. On the 7 Nov 2026 call Sergey Prokhorov called the missing Testnet a bug and asked for Mainnet first, Testnet back, and Localnet and Surfpool in the list; Slava agreed the same day. His last word on the call outranks the earlier Spec 07 cut. Ticket: [HOO-2707](https://linear.app/solana-fndn/issue/HOO-2707).

## What Changes

- Settings › Network offers five chips, in this order: Mainnet, Devnet, Testnet, Localnet, Surfpool. Devnet stays the default.
- Testnet points at the platform RPC `REACT_APP_TESTNET_RPC_URL` configures (listed in `.env.example`), else at `https://api.testnet.solana.com`, as Devnet and Mainnet do with theirs.
- Localnet is `http://localhost:8899`; Surfpool is `http://127.0.0.1:8899`, the address `surfpool start` serves. Both read as the `localnet` cluster, and the host tells their chips apart. Each is stored under a key of its own (`localnet`, `surfpool`).
- The "Deploy from your machine" guide's Cluster control offers Mainnet, Devnet, Testnet, with `--url testnet`, `--provider.cluster testnet` and `--rpc https://api.testnet.solana.com` for Testnet; it opens on Testnet when Playground is on it.
- A stored Devnet or Mainnet pick reads back unchanged. The `testnet` and retired `testnet-platform` keys read as the offered Testnet, on its platform RPC when one is set.
- Saved custom RPCs stay, except copies of a chip (a name and address a chip now has, such as an adopted "Localnet"), which are dropped. A profile on a local or Testnet chip's address in another spelling (`http://localhost:8899/`) moves onto the chip when no saved RPC lists it.

## Impact

- `client-v2/src/constants/connection.ts`, `shared/config/client-env.ts`, `settings/stored-endpoint.ts`, `entities/custom-rpc`, `widgets/settings-page`, `features/cli-deploy`.
- Specs: `mainnet-deploy-warning`, `cli-deploy`, `client-v2-custom-rpcs`.
