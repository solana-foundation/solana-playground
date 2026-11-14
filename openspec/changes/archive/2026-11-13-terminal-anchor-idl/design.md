# Design

## Context

See [proposal.md](proposal.md), "Why", for the motivation.

- `client-v2/src/commands/anchor/anchor.ts` passes the raw line to `runAnchor` of `@solana-playground/anchor-cli`,
  the wasm build of `wasm/anchor-cli`. Its `Cli` enum offers only `idl`, with nine subcommands, all on Anchor's
  legacy IDL account. `wasm/anchor-cli/Cargo.toml` is the only manifest under `wasm/` that depends on Anchor (0.29.0).
- Anchor 1.1.2's `anchor idl` has eleven subcommands. Seven run the `program-metadata` command-line client at 0.5.1
  through `npx` (`cli/src/metadata.rs` at tag `v1.1.2`): `init` and `upgrade` run `write idl <program> <file>`,
  `fetch` runs `fetch idl`, `close` runs `close <seed> <program>`, and `create-buffer`, `set-buffer-authority`, and
  `write-buffer` run the buffer commands. Anchor passes no format, encoding, or compression option, so that client's
  defaults apply. `convert`, `type`, and `fetch-historical` are Rust inside Anchor, and `build` runs `cargo`. A
  browser cannot run a command-line client, so the Playground calls the same program's JavaScript client.
- Anchor 1.1.2 keeps the nine subcommands of the legacy IDL account under a deprecated group, `anchor legacy-idl`.
  Its `anchor idl` has no `authority`, `set-authority`, `erase-authority`, or `set-buffer`.
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

- `anchor idl` in the terminal behaves as Anchor 1.1.2's CLI does: the same subcommands, arguments, options, and
  effects, with the differences "The surface is Anchor 1.1.2's" names and no others.
- `anchor idl init` works for a program the stable server built, with no argument at all.
- No Anchor 0.29 code is compiled or loaded for the terminal.

**Non-Goals:**

- Programs built before Anchor 1.1.2: the Playground does not carry them over, and Anchor 1.1.2's deprecated
  `anchor legacy-idl` group is not supported.
- An implementation of `anchor idl build`, `fetch-historical`, `convert`, and `type`.
- A check that the IDL's `address` equals the program id. The 0.29 command had none, and the two differ
  legitimately after the program keypair is replaced.

## Decisions

### The surface is Anchor 1.1.2's

The command offers Anchor 1.1.2's eleven `anchor idl` subcommands with its argument and option names, and prints
Anchor's success lines. A name Anchor does not have is an unknown subcommand. The Playground differs in these points,
each decided by the user:

| Difference | Reason |
| --- | --- |
| No `--provider.cluster`, `--provider.wallet`, `--commitment` | Settings pick the cluster and the wallet, and the mainnet refusal reads that selection |
| A path names a file of the project | The browser has no local disk and no `Anchor.toml` |
| `--filepath` is optional; without it, the latest IDL uploaded to the project | The stable build server returns no IDL, so the uploaded one is the project's IDL |
| Without `PROGRAM_ID` and `--filepath`, the project's program id | The uploaded IDL's `address` can differ from the project's program id after the program keypair is replaced |
| The six subcommands that send are refused on Mainnet | The beta's rule from #131 |
| `build`, `fetch-historical`, `convert`, and `type` print a not-supported line | `build` needs `cargo`, and no build server returns an IDL; `fetch-historical` replays transactions in Rust, with no JavaScript client; `convert` and `type` are Rust inside Anchor (see "`convert`, `type`, and `legacy-idl` are not supported") |
| `anchor legacy-idl` prints a not-supported line | The Playground carries no program built before Anchor 0.30, and the group's code is Rust inside Anchor |

Anchor's alias `b` for `build` is not offered. For a name that is no subcommand the terminal prints the usage of
`anchor idl`, where Anchor prints an error.

Copied from Anchor although they limit the user: `init` and `upgrade` send nothing on an endpoint whose URL contains
`localhost` or `127.0.0.1`, and `write-buffer` stores the format `none`, because Anchor passes no file to it.

Alternatives:

- Keep the four names Anchor removed, re-implemented on Program Metadata. Refused by the user: their behaviour would
  be the Playground's invention, and Anchor's documentation would not describe it.
- Offer `anchor legacy-idl fetch` and `close`. Refused by the user after they were built: the Playground carries no
  program built before Anchor 1.1.2 over, a program the stable server builds has no legacy IDL account, Anchor marks
  the group for removal, and the two subcommands needed a hand-written copy of Anchor's legacy account format and IDL
  instruction.

### The upload writes the canonical Program Metadata account

`init` and `upgrade` both create or replace the account derived from the program and the seed `idl`, with zlib
compression, UTF-8 encoding, JSON format, and direct data, which are the defaults of the command-line client Anchor
runs. Anchor 1.1.2's CLI makes no difference between the two subcommands either. That client refuses a canonical
write unless the wallet is the program's upgrade authority, so the check is read before sending and the refusal names
the authority. `init --non-canonical` writes the account derived from the program, the seed, and the wallet, and
skips that check.

Alternative: Anchor's legacy IDL instructions. Refused: an Anchor 1.1.2 program handles them only under
`#[program(legacy_idl)]`, which Anchor marks deprecated, and Explorer reads Program Metadata.

### `@solana-program/program-metadata` 0.11.0

Anchor 1.1.2 pins the command-line client at 0.5.1, which needs `@solana/kit` 6. `client-v2` has `@solana/kit`
8.6.0, and 0.11.0 needs 8.5.0 or later, so 0.11.0 adds no second copy of `@solana/kit`. Both versions write accounts
of the same on-chain program. That an account written by 0.11.0 is read by the 0.5.1 client is inference; task 3.1
checks it.

### The upload lives in a new feature slice, `program-idl`

`uploadIdl`, `NotProgramAuthorityError`, `idlMetadataAddress`, and `toStages` move from the spike's entity module to
`client-v2/src/features/program-idl/model/upload.ts`. An upload is a user action with events, and only a slice under
`features/` or `widgets/` has a tracker (`src/app/slice-structure.test.ts`). The slice registers the prefix `idl` in
`shared/lib/telemetry/prefixes.ts` and declares the three events in `model/telemetry.ts`. Its entry takes the IDL as
the project holds it, the program id, a connection, and a wallet, runs the checks, sends the events, and returns the
account address and whether it created or replaced the IDL.

The `wbdi-flow` change plans the same slice name and prefix (its task 3.1) and the Deploy stage's upload button (its
task 3.5). This change creates the slice; task 2.3 updates `wbdi-flow` so that 3.1 extends the slice and 3.5 calls
its entry, and task 4.5 points its on-chain read (its task 3.2) at this change's `fetch`.

### One send path for every subcommand that sends

`uploadIdl` plans, signs, and sends inline. Task 4.1 extracts that path into one function of the slice that takes an
instruction plan: it plans the transactions, asks the wallet once through `signAllTransactions`, and sends stage by
stage. `init`, `upgrade`, `close`, `create-buffer`, `set-buffer-authority`, and `write-buffer` build their plan from
the client's instructions and instruction plans and hand it to that function, `sendPlanWith` in `model/send.ts`,
which holds `toStages` too. The client's own `writeMetadata`, `updateMetadata`, and `createMetadata` send through the
client and so cannot ask the connected wallet; they are not used.

`sendPlanWith` adds `--priority-fee` to every transaction as a price in micro-lamports per compute unit. Without the
option the price is `DEFAULT_PRIORITY_FEE`, the default of the command-line client Anchor runs, and the Deploy
stage's upload pays it too. The command-line client sets a compute-unit limit from a simulation of each transaction.
The slice sets none, because it signs every transaction before it sends the first, so the same price costs more: by
calculation, not measurement, about 0.00002 SOL for each instruction at the default price.

### The read comes from the spike

`fetch` uses the client's `fetchMetadataContent`. The spike's `fetchProgramMetadataIdl` moves from its entity module
into the slice for it, and `wbdi-flow` task 3.2 calls the same function for the Flow view.

### `convert`, `type`, and `legacy-idl` are not supported

The Playground's part of `anchor idl` is a thin layer over the Program Metadata program's JavaScript client, the
client Anchor 1.1.2's CLI itself runs for the seven on-chain subcommands. `convert` and `type` (`convert_idl`,
`convert_idl_to_legacy`, and `idl_ts`) and the legacy IDL account are Rust inside Anchor, with no JavaScript
equivalent, so offering them means copying Anchor's code. They print the not-supported line that `build` and
`fetch-historical` print, and send `idl_command_failed` with the reason `unsupported`.

Alternatives:

- TypeScript ports checked against fixtures the Anchor 1.1.2 binary printed. Built, then refused by the user: about
  1,600 lines that copy Anchor's transformations and must follow every Anchor release by hand.
- A wasm build of Anchor's IDL crate. Refused: `anchor-cli`, which holds `idl_ts` and `convert_idl_to_legacy`, does
  not build for wasm, so the crate would be a hand-made fork, and it brings back a wasm package and its build time.

### The `anchor` command is a `createCmd` tree

`anchor` has the subcommand `idl`, which has Anchor 1.1.2's eleven subcommands, declared with `createCmd`'s
`subcommands` as `client-v2/src/commands/setting/setting.ts` does. The six that send run `checkWallet` (any wallet,
as `deploy` does, since the authority can be an external wallet), then #131's mainnet refusal and network hold, then
the slice. `fetch` asks for a wallet only with `--non-canonical`. `build`, `fetch-historical`, `convert`, and `type` throw a
`TerminalLineError` with the not-supported line, with no wallet check. `needsConnection` stays on `anchor`, which
keeps the offline line of `client-v2-terminal` for every line except `anchor --version` and `anchor -V`, which
`PgCommandManager.execute` answers before the offline check. #131's `isIdlWrite` becomes the six handlers themselves, so no list
of names can fall out of date.

A file argument is read from and written to the project through the explorer. Without `--filepath` the command passes
`PgProgramInfo.idl`, the IDL as the project holds it, to the slice. The slice uploads an IDL only when `readIdl` of
`entities/idl` returns `kind: "v1"`, and stringifies it with `JSON.stringify`.

### Events of the other subcommands

`init` and `upgrade` keep the three upload events, which `wbdi-flow`'s upload button shares. The other on-chain
subcommands share three events with the subcommand's name as a parameter, `idl_command_started`,
`idl_command_succeeded`, and `idl_command_failed`: five separate event families would differ only in their name.
`build` and `fetch-historical` send `idl_command_failed` with the reason `unsupported`, so the demand for them is
measured.

A subcommand refused on mainnet records the attempt: its start event, then its failure with the reason `mainnet`.
The user decided this, so that attempts on mainnet can be counted apart from the ones that ran; it is the order the
`wbdi-flow` change's mainnet guard already has. `rejected` was not reused, because it means the wallet declined the
approval. An endpoint that does not say which network it serves, and one that changed before the first send, end as
`rpc`. The mainnet check stays in the command, which reads the selected network; the slice owns the events, so it
exports what the command needs to record an attempt that ended before an entry ran.

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

### The `wasm/` workspace builds on Rust 1.95.0, the server's toolchain

`wasm/rust-toolchain.toml` and `wasm/Dockerfile` move from Rust 1.75.0 to 1.95.0, the toolchain the server builds
with, in commit `56122e55e`. The upstream crates under `wasm/` take the edits the new compiler and clippy require,
and `num-derive` moves to 0.4. `rust-analyzer` keeps its own `wasm/rust-analyzer/rust-toolchain.toml`: Rust 1.95
refuses to compile the `wasm-bindgen` below 0.2.88 that it pins, so `vercel-install.sh` installs each package's
`wasm-bindgen` with that package's toolchain (`package_toolchain`). An upstream sync that touches these crates
conflicts with the edits and keeps them.

## Risks / Trade-offs

- [The command work depends on #131] → #131 merged into `master` as `e1af2dfc2`, which this branch contains. The
  requirement the `mainnet-deploy-warning` delta modifies is in `openspec/specs/mainnet-deploy-warning/spec.md`, so
  `openspec archive` applies the delta.
- [An upload outlives its blockhash] → Every transaction shares one blockhash, read after planning, the last request
  before the wallet's one approval. A large IDL on a slow RPC, or a slow approval, can still expire it midway: the
  command prints that the transactions expired and to run it again, then the line for any buffer the send left, and
  running it again finishes the upload over that buffer.
- [An external wallet without `signAllTransactions`] → Not tested. The manual scenario "One approval from an
  external wallet" covers it before merge.
- [The spike was written on an older base] → Its imports from `@solana/kit` and the 0.11.0 client are checked by
  `yarn test-types` in task 1.1.
- [Facts read, not tested] → Task 4.2 read in the sources, at Anchor `v1.1.2` and the command-line client at 0.5.1,
  that `close` accepts only the program's upgrade authority, that the priority fee is in micro-lamports per compute
  unit, and that `write-buffer` stores the format `none`. Anchor's success lines are still from one reading; task 4.4
  checks them. Task 3.1 compares the results with the Anchor 1.1.2 binary on the same accounts.
- [`fetch` follows a URL data source] → A metadata account can name a URL as its data source, and the client then
  requests that URL from the browser, as the command-line client does from the user's machine. The host of that URL
  learns the user's network address. Accepted for `anchor idl fetch`, which the user runs for a program they name;
  `wbdi-flow` task 3.2 decides it for the Flow view's read.
- [The Program Metadata program's rules were read at `main`] → The deployed program can differ. Task 3.1 runs
  `close` and the buffer subcommands on Devnet.
- [The PR grows] → Section 4 of [tasks.md](https://github.com/solana-foundation/solana-playground/blob/e8da5e547c73621f317d5bef87f2bfc1b7154202/openspec/changes/terminal-anchor-idl/tasks.md) about doubles the change. The tasks stay in one PR so that
  `master` never holds a terminal with fewer `anchor idl` subcommands than Anchor 1.1.2.
- [Bundle size] → The Program Metadata client and Kit's planner are added, and the `anchor-cli` wasm module is
  removed. `yarn bundle:info` records the difference in task 2.2, and again in task 3.2 after section 4.
- [`client/` and its compose services no longer build] → Accepted; #126 removes the services, and a separate PR
  removes `client/`.
- [An upstream sync changes `wasm/anchor-cli`] → The sync keeps the folder deleted; `CLAUDE.md` records this in task
  2.2.

## Migration Plan

All tasks land in one PR, in the order of [tasks.md](https://github.com/solana-foundation/solana-playground/blob/e8da5e547c73621f317d5bef87f2bfc1b7154202/openspec/changes/terminal-anchor-idl/tasks.md). Reverting the PR restores `wasm/anchor-cli` and the
previous command. IDLs already in legacy IDL accounts stay on chain and are not touched.

## Open Questions

- Does a write that fails midway leave a buffer account that holds rent? The spike closes the buffer on success
  (`closeBuffer: true`). Task 3.1 looks at the accounts after a forced failure and files a ticket if rent is left.
