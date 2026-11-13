# Design

## Context

Playnet reaches client-v2 through one path: `PgConnection` in `client-v2/src/utils/connection.ts` calls
`PgPlaynet.init()` when the endpoint starts with `Endpoint.PLAYNET` (`http://playnet`). `PgPlaynet` imports the
package through `PgPackage.import("playnet")`, so the binary sits in a lazy chunk and loads only then. Settings
stores the network as an option key (`settings/stored-endpoint.ts`); `clusters.ts` keys every cluster, offered or
not, so the key `playnet` still resolves to `http://playnet`.

`client/package.json` also names `../wasm/pkgs/playnet`, and `client/` is never edited (`openspec/config.yaml`).

## Goals / Non-Goals

**Goals:**

- No path in client-v2 loads `@solana-playground/playnet`.
- `wasm/playnet` and its lockfile leave the repository, closing alerts 389, 391, 392, and 394.

**Non-Goals:**

- Deleting `wasm/pkgs/playnet`: `client/` would fail `yarn install` without it.
- Exporting or migrating a person's Playnet chain state from `/.playnet`.

## Decisions

- **A stored Playnet network falls back to the default network.** Removing `playnet` from `clusters.ts` leaves the
  stored key without a match, and the endpoint resolution in `stored-endpoint.ts` gives an unmatched key the
  default, Devnet. A raw `http://playnet` address, from a profile older than option keys, needs one explicit mapping
  to Devnet; without it the address would stay as an unnamed custom endpoint that nothing answers. Alternative
  rejected: keeping a stub that reports "Playnet is gone": it keeps the cluster in every type for one message.
- **`"playnet"` leaves the `Cluster` union.** Every branch that tests for it (`effects/tx`, `widgets/status`,
  `commands/deploy` pacing, `commands/airdrop/sign-in-gate`, `features/project-export`, the deploy and fund-wallet
  telemetry types) then fails type checking until it is removed, so `yarn test-types` finds them all.
- **`wasm/playnet` is deleted, not left excluded.** `wasm/Cargo.toml` already excludes it from the workspace, so no
  build reads it, but Dependabot scans its `Cargo.lock`. Deleting the folder closes the alerts; keeping it would
  need four dismissals for code nobody can build.
- **The build test guards the removal.** `scripts/bundle-modules.build-test.mjs` already fails on forbidden
  modules in the bundle; adding the Playnet package and its `playnet_bg.wasm` asset there catches a re-added
  import, which a unit test cannot see.

## Risks / Trade-offs

- [A person loses their Playnet accounts and programs] → Playnet has no chip, so only profiles saved before it was
  hidden can hold it. The chain state stays in IndexedDB unread; nothing deletes it.
- [An upstream sync restores `wasm/playnet` or Playnet code] → the root `CLAUDE.md` lists `wasm/playnet` beside
  `wasm/anchor-cli` as a folder a sync keeps deleted, and the build test fails on the package.
- [The open changes `funnel-events`, `wallet-chip-faucet`, `deploy-rpc-pacing`, and `wbdi-flow` name `playnet` in
  their deltas] → each drops it when it is next updated or archived; an archive that re-adds it is a review finding.

## Migration Plan

One PR. Rollback is a revert: the prebuilt package is still in `wasm/pkgs/playnet` for `client/`.
