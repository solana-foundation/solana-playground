# Spec Delta

## Purpose

The crate files the editor's Rust Analyzer loads from `/crates/`: which files
every deployment serves, and how they are produced from pinned inputs.

## ADDED Requirements

### Requirement: Every deployment serves the default crates

Every deployment SHALL serve the default crates `/crates/core.rs`,
`/crates/alloc.rs`, and `/crates/std.rs` as Rust source, generated from the
`rust-src` component of the toolchain in
`wasm/rust-analyzer/rust-toolchain.toml`. The build SHALL place them in
`client-v2/public/crates`, from which they ship with the static assets: the
Vercel build through `scripts/vercel-install.sh` and `yarn generate`, and the
Docker image build through `client-v2/Dockerfile`.

#### Scenario: A Vercel build places the default crates (manual)

- **WHEN** a Vercel build runs
- **THEN** its install log reports the default crates restored from a cache
  or generated, its `yarn generate` log reports them current, and the
  deployment's output holds `crates/core.rs`, `crates/alloc.rs`, and
  `crates/std.rs`

#### Scenario: A Docker image build places the default crates (manual)

- **WHEN** `client-v2/Dockerfile` builds an image, with or without the server
- **THEN** the image build log shows `core`, `alloc`, and `std` generated, the
  image holds them in `client-v2/public/crates`, and `yarn start` in the
  container reports them current

#### Scenario: A preview deployment (manual)

- **WHEN** `/crates/std.rs` is requested from a preview deployment
- **THEN** the response is HTTP 200 with Rust source, not HTML

#### Scenario: Standard library completion in the editor (manual)

- **WHEN** a user types `let v = Vec::` in `src/lib.rs` of an Anchor project
  and asks for completion
- **THEN** the list offers `Vec`'s associated functions, such as `capacity`
  and `clear`

#### Scenario: An API stabilized after Rust 1.60 (manual)

- **WHEN** a user writes `std::array::from_fn` in `src/lib.rs`
- **THEN** Rust Analyzer resolves the function, which Rust stabilized in 1.63

#### Scenario: A standalone Docker container (manual)

- **WHEN** the `client-v2-standalone` compose profile runs the client without
  the server
- **THEN** `/crates/std.rs` and `/crates/anchor_lang.toml` serve Rust source
  and TOML, and the container has no `rustc`, `cargo`, or `rustup`

### Requirement: Every deployment serves every supported crate

Every deployment SHALL serve `/crates/<name>.rs` and `/crates/<name>.toml` for
every crate in `supported-crates.json` and for their proc-macro dependencies,
with each crate name in snake case. The one exception is
`mpl-token-metadata`.

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

### Requirement: Generation fails when a supported crate cannot be generated

The crate generation SHALL exit non-zero, naming the crate, when it cannot
produce a supported crate.

#### Scenario: A crate missing from the registry (manual)

- **WHEN** the generation runs and a supported crate cannot be found
- **THEN** it fails with the crate's name and version, and the build fails

### Requirement: Generated files are reproducible from pinned inputs

The crate files SHALL depend on pinned inputs only:
`wasm/rust-analyzer/rust-toolchain.toml`, the versions of the expansion tool,
`server/programs/Cargo.lock`, the brotli version bundled with Node, and the
generation scripts. `supported-crates.json` is generated from
`server/programs/Cargo.lock`, not read. Two runs on the same inputs SHALL
produce identical bytes.

#### Scenario: Two runs (manual)

- **WHEN** the generation runs twice on the same inputs, on one machine or two
- **THEN** every file under `public/crates` has the same SHA-256 in both runs

#### Scenario: Three environments (manual)

- **WHEN** the crates are generated on macOS, on Vercel's builder, and in the
  `client-v2` Docker image
- **THEN** each served crate file has the same SHA-256 in all three

### Requirement: A build reuses the default crates of an unchanged input set

A Vercel build SHALL restore the default crates from a cache keyed on their
pinned inputs, and SHALL run their generation only when that key is absent
from the cache. The supported crates are generated in every build.

#### Scenario: A build with unchanged inputs (manual)

- **WHEN** a Vercel build runs on inputs that an earlier build generated
- **THEN** the build log reports the default crates restored from the cache,
  and the build installs no Rust toolchain for them

#### Scenario: The build step after a restore (manual)

- **WHEN** `yarn generate` runs in a build whose install restored the default
  crates
- **THEN** it logs that the default crates are current and skips their
  generation

#### Scenario: A build after an input changes (manual)

- **WHEN** `wasm/rust-analyzer/rust-toolchain.toml` changes
- **THEN** the next build generates the default crates and stores them under
  the key of the changed inputs
