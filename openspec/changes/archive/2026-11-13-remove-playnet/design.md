# Design

## Context

Playnet reaches client-v2 through one path: `PgConnection` in `client-v2/src/utils/connection.ts` calls
`PgPlaynet.init()` when the endpoint starts with `Endpoint.PLAYNET` (`http://playnet`). `PgPlaynet` imports the
package through `PgPackage.import("playnet")`, so the binary sits in a lazy chunk and loads only then. 
`client/package.json` also names `../wasm/pkgs/playnet`, and `client/` is never edited (`openspec/config.yaml`).
CI runs only prettier on `client/`, through `npx` and without `yarn install` (`reusable-checks.yml`, "Format
client").

## Goals / Non-Goals

**Goals:**

- No path in client-v2 loads `@solana-playground/playnet`.
- `wasm/playnet`, its lockfile, and the prebuilt `wasm/pkgs/playnet` leave the repository, closing alerts 389, 391,
  392, and 394.

**Non-Goals:**

- Editing `client/`: it is not shipped, and keeping it byte-identical keeps upstream syncs simple.
- Exporting or migrating a person's Playnet chain state from `/.playnet`.

## Decisions

- **No migration for a stored Playnet network.** client-v2 has no production release, and Settings stopped offering
  Playnet on 2026-11-02, so only a staging or preview profile can hold it. Such a profile picks a network in Settings
  again. Alternative rejected: mapping a stored `playnet` key or `http://playnet` address to Devnet, which is code and
  tests kept for profiles that do not exist in production.
- **`"playnet"` leaves the `Cluster` union.** Every branch that tests for it (`effects/tx`, `widgets/status`,
  `commands/deploy` pacing, `commands/airdrop/sign-in-gate`, `features/project-export`, the deploy and fund-wallet
  telemetry types) then fails type checking until it is removed, so `yarn test-types` finds them all.
- **`wasm/playnet` is deleted, not left excluded.** `wasm/Cargo.toml` already excludes it from the workspace, so no
  build reads it, but Dependabot scans its `Cargo.lock`. Deleting the folder closes the alerts; keeping it would
  need four dismissals for code nobody can build.
- **`wasm/pkgs/playnet` is deleted although `client/` names it.** The binary is the supply-chain risk; keeping it
  for a client nobody ships keeps the risk. Alternative rejected: stripping Playnet out of `client/`, which breaks the
  byte-identical rule for code nobody runs.
- **No guard against Playnet returning.** Once the code and the dependency are gone, nothing can add the package to
  the bundle; re-adding it means re-adding `@solana-playground/playnet` to `client-v2/package.json`, which review
  sees. Alternative rejected: a build test that fails on Playnet modules, which checks for code that no longer
  exists.

## Risks / Trade-offs

- [A staging or preview profile saved on Playnet loads an endpoint nothing answers] → the person picks a network in
  Settings; its `/.playnet` state stays in IndexedDB unread.
- [An upstream sync restores `wasm/playnet` or Playnet code] → the root `CLAUDE.md` lists `wasm/playnet` beside
  `wasm/anchor-cli` as a folder a sync keeps deleted.
- [The open changes `funnel-events`, `wallet-chip-faucet`, `deploy-rpc-pacing`, and `wbdi-flow` name `playnet` in
  their deltas] → each drops it when it is next updated or archived; an archive that re-adds it is a review finding.
- [Someone runs `yarn install` in `client/`] → it fails on the missing package; `client/` is not shipped and is due
  for removal.

## Migration Plan

One PR. Rollback is a revert of the PR, which restores `wasm/pkgs/playnet` with the rest.
