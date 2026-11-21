# Design

## Context

`solana` and `spl-token` reach the user through two layers each: a TypeScript command (`client-v2/src/commands/solana`,
`commands/spl-token`) that hands the raw input to a wasm package loaded by `PgPackage` (`utils/package.ts`), and the
Rust crate behind that package. Both crates sit on `wasm/solana-client` and four `wasm/utils/*` crates pinned to
Solana 1.18, which is what holds the five Dependabot alerts open. #176 removed `sugar` across the same files, and the
archived `remove-sugar-cli` change is the template for the build-side deletion.

What the app needs from `solana` today:

- `views/flow/stages/run-call.ts` runs `PgCommand.solana.execute("confirm", signature, "-v")` after an Interact call
  when "Transaction details in the terminal" is on.
- `commands/deploy/stopped.ts` (`closeBuffersCommandFor`) prints `solana program close --buffers [-u '<url>']` after
  a stopped or failed deploy.
- The open `deploy-rpc-pacing` change has Settings show `solana program show --buffers -u '<url>'` beside it.
- `utils/terminal/buffers-table.ts` fits the buffers table the Rust CLI prints to the terminal's width, reached
  through `PgTerminal.logWasm`.

`@solana/kit` 8.6 is already a dependency, and `commands/anchor` is a TypeScript command on it built with
`createCmd`, `createSubcmd` and `createOptions` (`commands/create.ts`).

## Goals / Non-Goals

**Goals:**

- The three subcommands print what the Rust CLI printed, so the tutorials, the test templates and the deploy lines
  stay correct.
- No `solana-cli` or `spl-token-cli` package in any build, and none of the seven crates in `wasm/Cargo.lock`.
- A restore of any removed command is a revert of the deletion commit, or a new TypeScript command.

**Non-Goals:**

- New `solana` subcommands, or flags the Rust CLI's three subcommands did not have (`--output json`,
  `--commitment`, `--ws`, `--lamports`).
- Reclaiming buffers whose authority is the standard wallet, which `commands/deploy/open-buffers.ts` records.
- The Mainnet refusal `wbdi-flow` specifies; this change only rewrites that delta's text to the surviving
  subcommands.
- Touching `wasm/utils/solana-playground-utils`, which `seahorse-compile` uses.

## Decisions

- **Rewrite in TypeScript on `@solana/kit`, not keep a slimmer Rust crate.** A Rust `solana` with three subcommands
  still needs a Solana client crate, and every one of those pins the vulnerable versions until the whole tree moves
  to Solana 2.x. Kit is already in the bundle, so the rewrite adds no dependency. Alternative considered: porting
  the crates to Solana 2.x: rejected, it is weeks of work for commands the app does not use.
- **Parity is checked against fixtures recorded from the Rust CLI.** Before the crates are deleted, the Rust
  `solana` runs on Devnet and its output is saved under `commands/solana/__fixtures__/`: `confirm -v` on a successful
  and a failed transaction, `confirm` on an unknown signature, `program show --buffers` with none and with one
  buffer, `program close --buffers` with none and with one, each with and without `-u`. Unit tests format the
  recorded RPC responses and compare against the recorded text. After the deletion, git history is the only source
  of that output.
- **`confirm -v` ports the Solana CLI's transaction printer.** The verbose text (`println_transaction` in
  `solana-cli-output`) is a fixed layout of slot, block time, version, recent blockhash, signatures, accounts with
  their flags, instructions, status, fee, balances and log messages. A module next to the command formats a
  `getTransaction` response (`encoding: "base64"`, as the recorded Rust requests used, decoded with Kit;
  `maxSupportedTransactionVersion: 0`) into that layout. One departure from the recordings: the status is asked
  with `searchTransactionHistory: true`, as the native CLI asks it; the wasm CLI asked without it, so a signature
  older than the RPC status cache (about two minutes) read "Not found" (found on Devnet, 2026-11-21). The default
  commitment is the app's commitment setting, as the Rust CLI's was.
- **Where the wallet check sits.** `checkPgWallet` moves from `solana` to its `program` subcommand, so `confirm`
  and an unknown subcommand ask nothing. `needsConnection` stays on `solana`, so the offline line comes first for
  all three.
- **`-u` is an option of `solana` itself.** `utils/command.ts` prints the usage for a command without a handler
  and throws "Subcommand doesn't exist" only for one that has a handler and options of its own. Declaring
  `-u`/`--url` on `solana`, with a handler that prints the subcommand list for a bare `solana`, gives the
  unknown-subcommand line the spec requires. The parser rejected `solana -u d confirm …` as an unexpected option,
  so `utils/command.ts` now lets a command have both a handler and subcommands, and moves the options such a
  command declares from before its subcommand to after it (`hoistParentOptionsWith` in `utils/command-options.ts`);
  each leaf subcommand declares `-u` too. `solana -u d confirm …` and `solana confirm -u d …` then both work, as
  they did with clap's global argument. Cluster names resolve as `normalize_to_url_if_moniker` did.
- **`--buffers` is required, not optional.** `program show` and `program close` without it end with an error that
  names `--buffers`: an address argument would bring back the closing of programs, which nothing in the app asks for.
- **`buffers-table.ts` stays the formatter.** The command prints the table through it directly instead of through
  `PgTerminal.logWasm`'s detection, which goes. `logWasm` itself stays: `solana-playground-utils` binds it.
- **Delete `spl-token`, do not hide it**, for the reason `remove-sugar-cli` gave: keeping the command without its
  package fails `yarn test-types`.
- **`wasm/Cargo.lock` is pruned by Cargo** (`cargo update --workspace` from `wasm/`), never by hand, as in
  `remove-sugar-cli`.
- **The deploy hint names the setting.** "Could not fetch on-chain data. Add a custom RPC in Settings, under
  Network, and try again." replaces the `solana config set -u` advice. Alternative considered: porting
  `solana config set -u`: rejected, the app already has the setting, and the command would change it behind the
  setting's back.
- **`wbdi-flow`'s delta is updated with `/opsx:update`**, in this change's PR: its Mainnet refusal names `solana
  program close --buffers` instead of `program close <program id>` and `set-upgrade-authority`, and its `-um`
  scenario runs `solana -um program close --buffers`.

## Risks / Trade-offs

- [The verbose printer drifts from the Solana CLI in a field the fixtures do not cover, such as address lookup
  tables or return data] → the fixtures include a version-0 transaction if Devnet offers one; a gap found later is a
  formatting fix, not a spec change.
- [A user relied on another `solana` subcommand or on `spl-token`] → the unknown-subcommand line names what exists;
  git history and the proposal's out-of-scope note say how they come back.
- [The bundle snapshot moves] → `bench/BUNDLE.md` is refreshed in the PR, and the description explains each row.

## Migration Plan

Ships in one PR into `master`. Rollback is a revert of that PR.
