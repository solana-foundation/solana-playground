# Design

## Context

`sugar` reaches the user through two layers: the TypeScript command in `client-v2/src/commands/sugar`, which the
generated command registry exports, and the WebAssembly package `@solana-playground/sugar-cli`, compiled from
`wasm/sugar-cli` and loaded by `PgPackage` (`utils/package.ts`). The stub tooling, the real-package bundle check
(`REAL_WASM_MARKERS`) and the wasm build all list it by name. #163 removed `wasm/anchor-cli` across the same files.

## Goals / Non-Goals

**Goals:**

- No `sugar` command in the terminal, and no `sugar-cli` package in any build, stubbed or real.
- A restore by HOO-2866 is a revert of this change's commit.

**Non-Goals:**

- Hiding `sugar` behind a flag or setting.
- Touching upstream's `client/`, or the `wasm/utils/*` crates `sugar-cli` shared with the other CLIs.
- Deleting `PgExplorer.writeGeneratedFileWith`, whose only caller was `sugar`: the open `sync-size-limits` change
  specifies it for the Sugar cache, and HOO-2866 needs it back on a restore. Open changes that mention `sugar`
  (`sync-size-limits`, `deploy-rpc-pacing`, `wbdi-flow`, `ui-migration`) are left to their own tickets.

## Decisions

- **Delete, do not hide.** Keeping the TypeScript command while dropping the package fails `yarn test-types`, since
  `PgPackage` types the import. A flag would keep the package in every wasm build and the bundle. Git history holds
  both folders for HOO-2866. Alternative considered: a hidden command that prints "not available": rejected, it keeps
  the package and differs from what an unknown command prints.
- **`wasm/Cargo.lock` is pruned by Cargo, not by hand.** After `sugar-cli` leaves the workspace members, a
  workspace-only lock update (`cargo update --workspace` offline, or `cargo metadata`) drops the crates only it used
  and changes no other version. If Cargo cannot run here, the lock is left for CI's wasm job to report rather than
  edited by hand. Alternative: hand-editing the lock: rejected, error-prone across a large dependency tree.
- **No test of the unknown-command line for `sugar` specifically.** `utils/command.test.ts` already covers the
  unknown-command line; `needs-connection.test.ts` asserts the full command list, so it fails while `sugar` exists and
  passes once it is gone.

## Risks / Trade-offs

- [The `sugar-cli` crate was the only user of some `wasm/utils/*` code] → that code stays; it is shared and pruning it
  is outside this ticket.
- [The bundle-size snapshot drops] → expected; the bundle check is updated in the same PR if it pins the chunk.

## Migration Plan

Ship with the release. Rollback is a revert of the commit.
