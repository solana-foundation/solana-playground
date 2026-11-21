# Proposal

## Why

The terminal's `solana` and `spl-token` commands are Rust CLIs compiled to WebAssembly (`wasm/solana-cli`,
`wasm/spl-token-cli`). Through the crates behind them they keep five Dependabot alerts open on the foundation
repository (borsh, ed25519-dalek, curve25519-dalek, rand, serde_with in `wasm/Cargo.lock`). No upgrade fixes those
alerts short of porting the crates to a newer Solana SDK. The app itself needs only three `solana` subcommands, and
nothing in it calls `spl-token`. Deleting the crates and rewriting those three subcommands in TypeScript closes the
alerts and leaves a smaller build. Ticket: HOO-2901.

## What Changes

- **BREAKING** The terminal no longer has an `spl-token` command. Typing `spl-token` (with or without arguments)
  ends with the unknown-command line, "`spl-token` is not a command. Type `help` to see commands.", and `help` does
  not list it.
- **BREAKING** `solana` keeps only three subcommands, rewritten in TypeScript. Their output matches what the Rust CLI
  printed:
  - `solana confirm [-v] <signature>`: the app runs it after an Interact call when "Transaction details in the
    terminal" is on, and every framework test template and four tutorials tell the user to run it.
  - `solana program close --buffers`: the app prints it after a stopped or failed deploy. It is the only way to
    reclaim a buffer's SOL in the app.
  - `solana program show --buffers`: the open `deploy-rpc-pacing` change has Settings show and copy it beside the
    close command.
  - Each takes `-u`/`--url` with a URL or a cluster name (`mainnet-beta`, `testnet`, `devnet`, `localhost`, or
    `m`, `t`, `d`, `l`), defaulting to the endpoint selected in the app. Any other subcommand ends with the
    terminal's existing "Subcommand doesn't exist" line, which lists the available ones. `solana --version` and every
    other Rust subcommand (`balance`, `airdrop`, `config`, `transfer` and the rest) are gone.
- `solana confirm` no longer asks for a wallet; the `program` subcommands still ask for the Playground Wallet.
- When on-chain data cannot be fetched, the deploy command now tells the user to add a custom RPC in Settings,
  instead of suggesting `solana config set -u`, which no longer exists.
- The Rust crates `wasm/solana-cli`, `wasm/spl-token-cli` and `wasm/solana-client`, and `wasm/utils/`
  `solana-cli-config`, `solana-cli-output`, `solana-clap-v3-utils` and `solana-extra`, are deleted, along with the
  packages `@solana-playground/solana-cli` and `@solana-playground/spl-token-cli`. User-visible consequence: a real
  wasm build compiles two packages (`rust-analyzer`, `seahorse-compile`) instead of four, and the production bundle
  no longer carries the two CLIs. Git history keeps every deleted folder.
- The open `wbdi-flow` change's Mainnet refusal names `solana program close <program id>` and
  `set-upgrade-authority`, neither of which survives. This change updates that delta so the refusal covers
  `solana program close --buffers`.
- Telemetry: no event is added, renamed or removed. No terminal command sends events, no slice under `features/` or
  `widgets/` changes, and the Interact call that runs `solana confirm` keeps its funnel events.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-terminal`: `spl-token` leaves the offline requirement's list; the wallet requirement's example moves
  from `solana balance` to a surviving subcommand; new requirements give the three `solana` subcommands, their `-u`
  option, the unknown-subcommand line, and no `spl-token`.
- `client-v2-build`: the real wasm packages no longer include `solana-cli` or `spl-token-cli`.

## Impact

- Code: `client-v2/src/commands/solana` (rewritten), `client-v2/src/commands/spl-token` (deleted),
  `client-v2/src/commands/deploy/deploy.ts` (the RPC hint), `client-v2/src/commands/needs-connection.test.ts`,
  `client-v2/src/utils/package.ts`, `client-v2/src/utils/terminal/terminal.ts` and `buffers-table.ts`,
  `client-v2/package.json`, `client-v2/yarn.lock`, `client-v2/scripts/wasm-stubs.{sh,mjs,test.mjs}`,
  `client-v2/scripts/vercel-install.sh`, `client-v2/bench/BUNDLE.md`, `client-v2/src/effects/connection/Local/steps.md`.
- Rust: the seven crates above (deleted), `wasm/Cargo.toml`, `wasm/Cargo.lock`, `wasm/build.sh`,
  `wasm/stub-packages.sh`, `wasm/README.md`. `wasm/utils/solana-playground-utils` stays: `seahorse-compile` uses it.
- Tests: `client-v2/e2e/wasm-clis.e2e.spec.ts`, `client-v2/e2e/client-v2-terminal.e2e.spec.ts`.
- Docs: `docs/assistant-context.md` (and its synced copy), `docs/testing.md`, `CLAUDE.md`, `client-v2/README.md`.
- Specs of other open changes: `openspec/changes/wbdi-flow/specs/client-v2-program-deploy/spec.md`.
- Out of scope: the four alerts no upgrade fixes (atty through `seahorse-dev`, and elliptic in three yarn lockfiles),
  which are dismissed on GitHub, not in code; reclaiming buffers held by the standard wallet, which
  `commands/deploy/open-buffers.ts` records but nothing reclaims yet; upstream's `client/`, which keeps its own CLIs;
  the user's own Solana CLI that `features/cli-deploy` refers to; archived OpenSpec changes, which record history.
  `spl-token` and the other `solana` subcommands come back from git history, or as TypeScript, if users ask for them.
