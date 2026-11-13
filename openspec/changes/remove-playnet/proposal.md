# Proposal

## Why

Playnet is a supply-chain risk the project cannot manage. `wasm/pkgs/playnet` is a prebuilt wasm binary last changed
on 2023-01-15, built from `wasm/playnet`, whose Solana and rbpf dependencies are path dependencies on
`../../../forks/solana` and `../../../forks/rbpf`. Those forks are not in the repository, so nobody can audit what the
binary holds, rebuild it from source, or patch it. Its lockfile carries Dependabot alerts 389 (borsh), 391
(ed25519-dalek), 392 (curve25519-dalek), and 394 (rand) that no version bump can close, because cargo cannot resolve
the lockfile without the forks.

client-v2 already stopped offering Playnet: Settings lists Mainnet, Devnet, Testnet, Localnet, and Surfpool, and
`PgCustomRpcs.adopt` refuses `http://playnet`. The binary still ships in the client-v2 bundle and starts when a stored
endpoint is `http://playnet`. Localnet and Surfpool give a local validator on a current runtime, and Devnet needs no
install.

## What Changes

- **BREAKING** client-v2 no longer runs Playnet. `@solana-playground/playnet` leaves `client-v2/package.json`, and
  `src/utils/playnet`, `PgPlaynet`, the `"playnet"` cluster, and `Endpoint.PLAYNET` go.
- A stored endpoint of `http://playnet` opens on Devnet, the default network, instead of an address nothing answers.
- `wasm/playnet` (the Rust sources and their `Cargo.lock`) is deleted. `wasm/pkgs/playnet` stays while `client/`
  depends on it.
- The transaction toast, the status indicator, the deploy pacing, the airdrop sign-in gate, the block-explorer links,
  and the TypeScript export drop their Playnet branches.
- Telemetry: no event is added or renamed. The `cluster` parameter of `fund_sent` and of the deploy slice's events
  loses the value `"playnet"`. The deploy and fund funnel steps keep every event they fire.
- `docs/assistant-context.md` stops naming Playnet as a local validator.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mainnet-deploy-warning`: the five-network requirement stops naming Playnet as an endpoint no chip names, and a
  stored Playnet endpoint opens on Devnet.
- `client-v2-block-explorers`: Orb's list of networks it cannot open drops playnet.
- `client-v2-interact`: the transaction toast loses its playnet exception.
- `client-v2-wallet-funding`: `fund_sent`'s `cluster` loses `"playnet"`.
- `project-export`: the exported cluster's fallback stops naming playnet.
- `client-v2-build`: the client-v2 bundle carries no Playnet package.

## Impact

- **Users:** a person whose saved network is Playnet opens on Devnet. Accounts and programs on their Playnet chain,
  held in the browser's `/.playnet` folder, are no longer reachable. Nobody else sees a change: Playnet has no chip.
- **Code:** `client-v2/src/utils/playnet`, `utils/connection.ts`, `entities/cluster`, `settings/stored-endpoint.ts`,
  `effects/tx`, `widgets/status`, `commands/deploy`, `commands/airdrop`, `features/project-export`, the deploy and
  fund-wallet telemetry types, `craco.config.js`, `e2e/client-v2-layout.e2e.spec.ts`, and their tests.
- **Dependencies:** `@solana-playground/playnet` leaves the client-v2 install. `wasm/playnet/Cargo.lock` and its four
  alerts leave the repository.
- **Upstream sync:** `wasm/playnet` stays deleted on every sync, as `wasm/anchor-cli` does.
- **Out of scope:** `client/` and `wasm/pkgs/playnet`, which `client/package.json` names; both go when `client/` is
  removed. The open changes `funnel-events`, `wallet-chip-faucet`, `deploy-rpc-pacing`, and `wbdi-flow` still name
  Playnet in their deltas; each drops it when it next lands or is updated, not in this change.
