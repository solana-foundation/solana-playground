# Design

## Context

See [proposal.md](proposal.md), "Why", for the motivation.

- `client-v2/src/commands/anchor/anchor.ts` passes the raw line to `runAnchor` of `@solana-playground/anchor-cli`,
  the wasm build of `wasm/anchor-cli`. Its `Cli` enum offers only `idl`, with nine subcommands, all on Anchor's
  legacy IDL account. `wasm/anchor-cli/Cargo.toml` is the only manifest under `wasm/` that depends on Anchor (0.29.0).
- Anchor 1.1.2's CLI runs `program-metadata write idl <program> <file>` for both `idl init` and `idl upgrade`
  (`cli/src/metadata.rs` at tag `v1.1.2`). A browser cannot run that command, so the Playground calls the same
  program's JavaScript client.
- The HOO-2486 spike (commit `aaa4be84d` on `hoodieshq/slavakoreshkov/hoo-2486-pmp-idl-spike`) holds a working
  `uploadIdl` in `client-v2/src/entities/idl/model/program-metadata.ts`, on `@solana-program/program-metadata` 0.11.0.
  It is not in `master`.
- #131 (HOO-2737) edits `anchor.ts`: it refuses `anchor idl` writes on mainnet (`refuseMainnetWith(IDL_REFUSAL)`),
  refuses an endpoint that changed (`IDL_NETWORK_CHANGED`), and holds the network while a write runs
  (`PgGlobal.isIdlWriting`).
- The project's IDL arrives by hand: the stable server returns none, and `loadIdlFile` in
  `client-v2/src/views/flow/stages/IdlActions.tsx` stores the uploaded file in `PgProgramInfo.idl` as it arrived.
  `PgProgramInfo.readIdl()` tells the Anchor 0.30+ format (`kind: "v1"`) from 0.29 (`kind: "v029"`).

## Goals / Non-Goals

**Goals:**

- `anchor idl init` works for a program the stable server built, with the arguments it took before: an optional
  program id.
- No Anchor 0.29 code is compiled or loaded for the terminal.

**Non-Goals:**

- Compatibility with programs built on Anchor 0.29, or with IDLs in the legacy IDL account.
- A check that the IDL's `address` equals the program id. The 0.29 command had none, and the two differ
  legitimately after the program keypair is replaced.
- Moving `wasm/` to another Rust version.

## Decisions

### The upload writes the canonical Program Metadata account

`init` and `upgrade` both create or replace the account derived from the program and the seed `idl`, with zlib
compression, UTF-8 encoding, JSON format, and direct data. Anchor 1.1.2's CLI makes no difference between the two
subcommands either. Only the program's upgrade authority can write the canonical account, so the authority check is
the program's own rule, read before sending so that the refusal names the authority.

Alternatives:

- Anchor's legacy IDL instructions. Refused: an Anchor 1.1.2 program handles them only under
  `#[program(legacy_idl)]`, which Anchor marks deprecated, and Explorer reads Program Metadata.
- A non-canonical account for a wallet that is not the authority. Left out: no reader in the Playground looks for
  one.

### `@solana-program/program-metadata` 0.11.0

Anchor 1.1.2 pins the command-line client at 0.5.1, which needs `@solana/kit` 6. `client-v2` has `@solana/kit`
8.6.0, and 0.11.0 needs 8.5.0 or later, so 0.11.0 adds no second copy of `@solana/kit`. Both versions write accounts
of the same on-chain program. That an account written by 0.11.0 is read by the 0.5.1 client is inference; task 3.1
checks it.

### The upload lives in a new feature slice, `program-idl`

`uploadIdl`, `NotProgramAuthorityError`, `idlMetadataAddress`, and `toStages` move from the spike's entity module to
`client-v2/src/features/program-idl/model/upload.ts`. An upload is a user action with events, and only a slice under
`features/` or `widgets/` has a tracker (`src/app/slice-structure.test.ts`). The slice registers the prefix `idl` in
`shared/lib/telemetry/prefixes.ts` and declares the three events in `model/telemetry.ts`. Its entry takes the IDL
JSON, the program id, a connection, and a wallet, runs the checks, sends the events, and returns the account address
and whether it created or replaced the IDL. The spike's `fetchProgramMetadataIdl` is not moved: `wbdi-flow` task 3.2
owns reading.

The `wbdi-flow` change plans the same slice name and prefix (its task 3.1) and the Deploy stage's upload button (its
task 3.5). This change creates the slice with the upload only; task 2.3 updates `wbdi-flow` so that 3.1 extends the
slice and 3.5 calls its entry.

### The `anchor` command is a `createCmd` tree

`anchor` has the subcommand `idl`, which has `init` and `upgrade`, declared with `createCmd`'s `subcommands` as
`client-v2/src/commands/setting/setting.ts` does. `init` and `upgrade` take the optional program id, run
`checkWallet` (any wallet, as `deploy` does, since the authority can be an external wallet), then #131's mainnet
refusal and network hold, then the slice's entry. The seven unsupported names are subcommands without a wallet check
whose handler throws a `TerminalLineError` with the not-supported line. `needsConnection` stays on `anchor`, which
keeps the offline line of `client-v2-terminal`. #131's `isIdlWrite` becomes the `init` and `upgrade` handlers
themselves, so no list of names can fall out of date.

The IDL comes from `PgProgramInfo.getIdlStr()`, sent as the project holds it, and only when
`PgProgramInfo.readIdl()` returns `kind: "v1"`.

### One approval for the whole upload

The spike plans every transaction first, signs them in one `signAllTransactions` call, and sends them stage by
stage. A Playground wallet signs without a prompt; an external wallet shows one prompt.

### `wasm/anchor-cli` is deleted in the same PR, after the command stops loading it

Files that name the package: `client-v2/package.json`, `client-v2/src/utils/package.ts`, `WASM_PACKAGES` in
`client-v2/scripts/wasm-stubs.sh`, `REAL_WASM_MARKERS` in `client-v2/scripts/wasm-stubs.mjs`, the fixture of
`client-v2/scripts/wasm-stubs.test.mjs`, the comment on install order in `client-v2/scripts/vercel-install.sh`,
`wasm/build.sh`, `wasm/stub-packages.sh`, the `members` of `wasm/Cargo.toml`, `wasm/Cargo.lock`, `docs/testing.md`,
and the wasm paragraph of `CLAUDE.md`. `client/` is not edited.

### `cicd.yml` stops building `client/`

`cicd.yml` passes `with: build: false` to `reusable-checks.yml`. The `build` job and its input stay until the PR that
removes `client/`. The commit that deletes `wasm/anchor-cli` must not come before this one: a tagged push would run
the `build` job on a `client/` that cannot install, and `deploy_server` needs `checks`. Every `uses:` line of
`cicd.yml` is pinned by commit SHA in the same edit, as `.github/actions/gcp-auth/action.yml` pins its actions.

## Risks / Trade-offs

- [#131 is not in `master`] → Task 1.2 starts after #131 merges and this branch is updated from `master`. The
  `mainnet-deploy-warning` delta modifies a requirement #131 adds, so `openspec archive` fails before then.
- [An upload outlives its blockhash] → Every transaction shares one blockhash. A large IDL on a slow RPC can expire it
  midway. The command prints the failed transaction, and running it again starts a new write.
- [An external wallet without `signAllTransactions`] → Not tested. The manual scenario "One approval from an
  external wallet" covers it before merge.
- [The spike was written on an older base] → Its imports from `@solana/kit` and the 0.11.0 client are checked by
  `yarn test-types` in task 1.1.
- [Bundle size] → The Program Metadata client and Kit's planner are added, and the `anchor-cli` wasm module is
  removed. `yarn bundle:info` records the difference in task 2.2.
- [`client/` and its compose services no longer build] → Accepted; #126 removes the services, and a separate PR
  removes `client/`.
- [An upstream sync changes `wasm/anchor-cli`] → The sync keeps the folder deleted; `CLAUDE.md` records this in task
  2.2.

## Migration Plan

All tasks land in one PR, in the order of [tasks.md](tasks.md). Reverting the PR restores `wasm/anchor-cli` and the
previous command. IDLs already in legacy IDL accounts stay on chain and are not touched.

## Open Questions

- Does a write that fails midway leave a buffer account that holds rent? The spike closes the buffer on success
  (`closeBuffer: true`). Task 3.1 looks at the accounts after a forced failure and files a ticket if rent is left.
