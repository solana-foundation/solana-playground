# Proposal

## Why

Playnet is a supply-chain risk the project cannot manage. `wasm/pkgs/playnet` is a prebuilt wasm binary last changed
on 2023-01-15, built from `wasm/playnet`, whose Solana and rbpf dependencies are path dependencies on
`../../../forks/solana` and `../../../forks/rbpf`. Those forks are not in the repository, so nobody can audit what the
binary holds, rebuild it from source, or patch it. Its lockfile carries Dependabot alerts 389 (borsh), 391
(ed25519-dalek), 392 (curve25519-dalek), and 394 (rand) that no version bump can close, because cargo cannot resolve
the lockfile without the forks.

client-v2 already stopped offering Playnet: Settings lists Mainnet, Devnet, Testnet, Localnet, and Surfpool, and
`PgCustomRpcs.adopt` refuses `http://playnet`. The binary still ships in the client-v2 bundle as a lazy chunk. Localnet and Surfpool give a local validator on a current runtime, and Devnet needs no
install.

## What Changes

- **BREAKING** client-v2 no longer runs Playnet. `@solana-playground/playnet` leaves `client-v2/package.json`, and
  `src/utils/playnet`, `PgPlaynet`, the `"playnet"` cluster, and `Endpoint.PLAYNET` go.
- `wasm/playnet` (the Rust sources and their `Cargo.lock`) and the prebuilt `wasm/pkgs/playnet` are deleted.
  `client/` still names the package and can no longer install or build; it is not shipped.
- The transaction toast, the status indicator, the deploy pacing, the airdrop sign-in gate, the block-explorer links,
  and the TypeScript export drop their Playnet branches.
- Telemetry: no event is added or renamed. The `cluster` parameter of `fund_sent` and of the deploy slice's events
  loses the value `"playnet"`. The deploy and fund funnel steps keep every event they fire.
- `docs/assistant-context.md` stops naming Playnet as a local validator.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mainnet-deploy-warning`: the five-network requirement stops naming Playnet as an endpoint no chip names.
- `client-v2-block-explorers`: Orb's list of networks it cannot open drops playnet.
- `client-v2-interact`: the transaction toast loses its playnet exception.
- `client-v2-wallet-funding`: `fund_sent`'s `cluster` loses `"playnet"`.
- `project-export`: the exported cluster's fallback stops naming playnet.

## Impact

- **Users:** none see a change. client-v2 has no production release, and Settings stopped offering Playnet on
  2026-11-02, so no production profile holds it.
- **Code:** `client-v2/src/utils/playnet`, `utils/connection.ts`, `entities/cluster`, `settings/stored-endpoint.ts`,
  `effects/tx`, `widgets/status`, `commands/deploy`, `commands/airdrop`, `features/project-export`, the deploy and
  fund-wallet telemetry types, `craco.config.js`, `e2e/client-v2-layout.e2e.spec.ts`, and their tests.
- **Dependencies:** `@solana-playground/playnet` leaves the client-v2 install. `wasm/playnet/Cargo.lock` and its four
  alerts leave the repository, and so does the Playnet binary.
- **Upstream sync:** `wasm/playnet` and `wasm/pkgs/playnet` stay deleted on every sync, as `wasm/anchor-cli` does.
- **Out of scope:** `client/`: it stays unedited and still names `../wasm/pkgs/playnet`, so its `yarn install`
  fails. CI only runs prettier there through `npx`, without an install. Removing `client/` is a separate change. The
  open changes `funnel-events`, `wallet-chip-faucet`, `deploy-rpc-pacing`, and `wbdi-flow` still name
  Playnet in their deltas; each drops it when it next lands or is updated, not in this change.
