# Proposal

## Why

The stable build server builds programs with Anchor 1.1.2 (change `stable-anchor-1-1-2`), and the terminal's
`anchor` command runs a WebAssembly build of Anchor's CLI at 0.29. Its `idl init` parses the project's IDL as the
0.29 format and sends Anchor's legacy IDL instructions to the program. An Anchor 1.1.2 program handles those
instructions only under `#[program(legacy_idl)]`, and Anchor 1.1.2's own CLI publishes an IDL through the Program
Metadata program. A user who deploys from the Playground can therefore publish the program's IDL only from their own
machine. The failure is read from the source of `wasm/anchor-cli` and `anchor-syn` 1.1.2; it is not reproduced on a
cluster. Ticket: to file.

## What Changes

- `anchor idl init` and `anchor idl upgrade` are handled in TypeScript. Each writes the IDL the project holds to the
  program's canonical Program Metadata account (seed `idl`) on the selected cluster, creating the account or
  replacing an earlier IDL, with one wallet approval. Anchor 1.1.2's CLI writes the same account, and Explorer reads
  it.
- Nothing is sent when the project holds no IDL in the Anchor 0.30+ format, when the connected wallet is not the
  program's upgrade authority, or on Mainnet Beta (the refusal #131 adds for `anchor idl` writes).
- **BREAKING** `anchor idl authority`, `close`, `erase-authority`, `fetch`, `set-authority`, `set-buffer`, and
  `write-buffer` end with one line saying the Playground terminal does not support them. They act on Anchor's legacy
  IDL account, which an Anchor 1.1.2 program does not serve.
- **BREAKING** An IDL in the Anchor 0.29 format is not uploaded.
- A feature slice `program-idl` (event prefix `idl`) holds the upload, taken from the HOO-2486 spike. It adds three
  events, with the names and parameters the `wbdi-flow` change gives them: `idl_upload_started`, `idl_uploaded`, and
  `idl_upload_failed`. No event is renamed or removed.
- `client-v2` stops loading `@solana-playground/anchor-cli`, and `wasm/anchor-cli` is deleted. The real wasm packages
  go from six to five, and no wasm build compiles Anchor 0.29. For the user, a cold `yarn setup` and a cold Vercel
  build compile one package fewer.
- `cicd.yml` passes `build: false` to `reusable-checks.yml`, as `ci.yml` does. `client/` depends on the deleted
  package, so no workflow builds it. For a release, the server deploy starts without the `client/` build, which takes
  more than 20 minutes.
- No funnel step's code is touched: the funnel table names no `anchor` code.

## Capabilities

### New Capabilities

- `client-v2-program-idl`: how the project's IDL is published on chain from the terminal: which `anchor idl`
  subcommands write it, where, when they refuse, and the events of an upload. The `wbdi-flow` change adds its own
  requirements to the same capability.

### Modified Capabilities

- `client-v2-build`: the real wasm packages are the ones `WASM_PACKAGES` names, without `anchor-cli`; the
  requirements stop stating a count.
- `mainnet-deploy-warning`: the refusal of `anchor idl` writes on mainnet covers `init` and `upgrade`, the only
  subcommands that send a transaction. This modifies the requirement #131 adds, so the delta is valid once #131 is in
  `master`.

## Impact

- **Code:** `client-v2/src/features/program-idl` (new), `client-v2/src/commands/anchor`,
  `client-v2/src/utils/package.ts`, `client-v2/package.json`, `client-v2/scripts/wasm-stubs.sh`,
  `client-v2/scripts/wasm-stubs.mjs`, `client-v2/bench/BUNDLE.md`, `wasm/anchor-cli` (deleted), `wasm/Cargo.toml`,
  `wasm/Cargo.lock`, `wasm/build.sh`, `wasm/stub-packages.sh`, `.github/workflows/cicd.yml`,
  `.github/workflows/reusable-checks.yml` (the comment on its `build` input), `CLAUDE.md`, `docs/testing.md`.
- **Dependency:** `@solana-program/program-metadata` 0.11.0, which needs `@solana/kit` 8.5.0 or later; `client-v2`
  has 8.6.0.
- **Order:** the `anchor` command work follows #131 (HOO-2737), which edits the same file and owns the mainnet
  refusal.
- **`client/`:** not edited. Its `package.json` names `../wasm/anchor-cli/pkg`, so it no longer installs, and the
  compose services built from `client/Dockerfile` (`client`, `client-prod`, `client-standalone`) no longer build.
  #126 removes those services.
- **Upstream sync:** a sync that changes `wasm/anchor-cli` upstream conflicts with the deletion; the folder stays
  deleted.
- **Out of scope:** the Deploy stage's upload button (`wbdi-flow` task 3.5) and reading the on-chain IDL
  (`wbdi-flow` task 3.2); a TypeScript `anchor idl fetch`; the legacy Anchor IDL account; non-canonical metadata
  accounts; removing `client/` or the `build` job of `reusable-checks.yml`; the Rust version of the `wasm/`
  workspace.
