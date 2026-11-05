# Proposal

## Why

The public Solana RPCs rate-limit a shared app, worst on mainnet, so the
network list should offer only the platform's own RPCs. The demo-build review
on 30 Oct 2026 (Sergey Prokhorov) also found "Mainnet Beta" and lowercase
cluster names on several screens; by release the cluster is called Mainnet,
and a cluster's name is a proper noun. Ticket: HOO-2488.

## What Changes

- Settings › Network offers exactly two chips, "Devnet" and "Mainnet". Each
  points at the platform RPC the env configures (`REACT_APP_DEVNET_RPC_URL`,
  `REACT_APP_MAINNET_RPC_URL`) and falls back to the public URL when the env
  sets none. The public Devnet, Testnet, Localnet and Mainnet Beta chips and
  the "(Platform)" suffix go. The endpoint setting's list is the same two.
- A profile that stored the public Devnet or Mainnet Beta pick, or a platform
  pick under its old key, opens on the matching new chip. A Testnet, Localnet
  or Playnet pick keeps its address and shows no chip checked.
- Every cluster name shown to a person is capitalised: Devnet, Mainnet,
  Testnet, Localnet, Playnet. `mainnet-beta` is shown as "Mainnet"
  (Deploy buttons and cards, Interact head and history, Explorer labels,
  wallet funding, footer status, CLI guide copy).
- The cluster moniker in URLs, CLI commands and telemetry stays
  `mainnet-beta`: on 2 Nov 2026 `api.mainnet-beta.solana.com` and
  `api.mainnet.solana.com` answer the same genesis hash.
- Telemetry: no event added, renamed or removed; cluster parameters keep
  their monikers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mainnet-deploy-warning`: "Settings offers Mainnet Beta" becomes
  "Settings offers Devnet and Mainnet".
- `client-v2-deploy`: the deploy action and history labels name the
  network capitalised.
- `client-v2-interact`: the head names the network capitalised.
- `client-v2-build`: the dependent-change scenario switches Devnet to Mainnet,
  since Testnet is no longer offered.

## Impact

- Code: `constants/connection.ts`, `settings/connection`, `settings/stored-endpoint.ts`,
  `widgets/settings-page` (network chips), every place that prints a cluster
  name (`features/deploy`, `features/fund-wallet`, `features/cli-deploy`,
  `widgets/session-footer`, `views/flow/stages`).
- e2e specs that pick or read a network by name.
- Out of scope: custom RPC URLs (HOO-2489), cluster aliases (HOO-2498), the
  build server list, terminal command output, the Rust `server/`.
