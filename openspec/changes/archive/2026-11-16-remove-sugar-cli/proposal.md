# Proposal

## Why

The terminal offers `sugar`, Metaplex's Candy Machine CLI, but none of its subcommands has been run against Devnet in
client-v2 (HOO-2866). A subcommand that fails midway leaves the user's SOL in Candy Machine accounts; a command the
terminal does not offer fails no one. The customer release is on 19 November, so `sugar` comes out now and HOO-2866
restores it from git history if it proves worth keeping. Ticket: HOO-2867.

## What Changes

- **BREAKING** The terminal no longer has a `sugar` command. Typing `sugar` (with or without arguments) ends with the
  terminal's unknown-command line, "`sugar` is not a command. Type `help` to see commands.", and `help` does not list
  it.
- `client-v2/src/commands/sugar` and the Rust crate `wasm/sugar-cli` are deleted. Git history keeps both.
- `@solana-playground/sugar-cli` is no longer a dependency of client-v2, a member of the wasm Cargo workspace, a
  package `wasm/build.sh` compiles, a stub `wasm/stub-packages.sh` writes, or a name in `WASM_PACKAGES` and
  `REAL_WASM_MARKERS`. User-visible consequence: a real wasm build compiles one package fewer, and the production
  bundle no longer carries the Candy Machine CLI.
- The `sugar --help` browser test and `sugar` in the offline command list go with the command.
- The in-product assistant's context (`docs/assistant-context.md`) stops naming `sugar`.
- Telemetry: no event is added, renamed or removed. No slice under `features/` or `widgets/` changes, and no funnel
  step's code is touched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-build`: the real wasm packages no longer include `sugar-cli`, as they no longer include `anchor-cli`.
- `client-v2-terminal`: `sugar` leaves the offline requirement's list of commands that need a connection.

## Impact

- Code: `client-v2/src/commands/sugar` (deleted), `client-v2/src/utils/package.ts`, `client-v2/package.json`,
  `client-v2/yarn.lock`, `client-v2/scripts/wasm-stubs.{sh,mjs,test.mjs}`, `client-v2/craco.config.js` (a chunk-name
  pattern), `client-v2/src/commands/needs-connection.test.ts`, `client-v2/e2e/wasm-clis.e2e.spec.ts`.
- Rust: `wasm/sugar-cli` (deleted), `wasm/Cargo.toml`, `wasm/Cargo.lock`, `wasm/build.sh`, `wasm/stub-packages.sh`.
- Docs: `docs/assistant-context.md` (and its synced copy), `docs/testing.md`, `CLAUDE.md`, `client-v2/README.md`.
- Out of scope: validating `sugar` on Devnet and restoring it (HOO-2866); the upstream client in `client/`, which keeps
  its own `sugar`; comments that mention Sugar's cache as an example (`utils/explorer/explorer.ts`); archived OpenSpec
  changes, which record history. The divergence register entry (`docs/upstream-divergences.md`) is committed on
  `context-archive`, where the register lives, not in this change.
