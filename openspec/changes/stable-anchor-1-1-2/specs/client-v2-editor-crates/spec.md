# Spec Delta

## MODIFIED Requirements

### Requirement: Every deployment serves every supported crate

Every deployment SHALL serve `/crates/<name>.rs` and `/crates/<name>.toml` for
every crate in `supported-crates.json`, for their proc-macro dependencies, and
for every other dependency they reach in `server/programs/Cargo.lock`, so a path
that a supported crate re-exports from another crate resolves. Under a
proc-macro crate only proc-macro dependencies are served, and a reached crate
the expansion tool cannot read is skipped with a warning. Each crate name is in
snake case. Rust Analyzer SHALL see each crate with the features the lockfile's
resolution enables for it. The exceptions are `mpl-bubblegum` and
`mpl-token-metadata`: their generated modules are raw identifiers
(`mod r#name`), and the expansion tool looks for a file named `r#name.rs`.

#### Scenario: A feature-gated item (manual)

- **WHEN** the Native starter calls `msg!("hello")`, which `solana_msg` defines
  under `#[cfg(feature = "alloc")]`
- **THEN** the editor marks no error on `msg!`

#### Scenario: A type re-exported through solana_program (manual)

- **WHEN** the Native starter's `src/lib.rs` imports `solana_program::{msg, pubkey::Pubkey}`
  in the editor
- **THEN** neither item is marked as an error, and hovering `Pubkey` shows its
  definition from `solana_pubkey`

#### Scenario: The Anchor prelude (manual)

- **WHEN** an Anchor project's `src/lib.rs` starts with
  `use anchor_lang::prelude::*;` in the editor
- **THEN** `Context`, `Account`, and `Signer` resolve, and hovering one shows
  its definition

#### Scenario: A Solana type from the prelude (manual)

- **WHEN** a user types `Pubkey::find_` in an Anchor project and asks for
  completion
- **THEN** the list offers `find_program_address` with its signature and its
  documentation from `solana_program`

#### Scenario: Opening an Anchor project starts Rust Analyzer (manual)

- **WHEN** a user creates an Anchor project and the editor loads its crates
- **THEN** the console shows no Rust Analyzer panic, such as
  `Parse(Error { … Unexpected('<') … })` from `world_state.rs`, which a crate
  file served as `index.html` causes

#### Scenario: A Vercel build (manual)

- **WHEN** a Vercel build runs
- **THEN** its log shows `generate-crates.mjs` generating every supported
  crate, and no "not found"
