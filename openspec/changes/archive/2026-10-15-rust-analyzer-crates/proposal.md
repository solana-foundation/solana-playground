# Proposal

## Why

At
[`b1bf2cf`](https://github.com/hoodieshq/solana-playground/commit/b1bf2cfc374b39c6bf016e638baa9b4ffc913490),
no `client-v2` deployment served the crate files Rust Analyzer loads from
`/crates/`. Preview and production answered `/crates/std.rs`,
`/crates/anchor_lang.rs`, and every other crate file with `index.html` and
HTTP 200, so `Vec::`, `format!`, and most of `anchor_lang` resolved to nothing.

Two gaps cause it:

- **The default crates (`core`, `alloc`, `std`) have no recipe.** Nothing in
  the history of `master` produces them; `generate-crates`
  only keeps existing copies. Upstream serves hand-made copies from Amazon S3
  (design.md, "Upstream reference").
- **The supported crates are never found on Vercel.** `generate-crates` reads
  them from the local cargo registry, which on Vercel never holds the crates
  of `server/programs`. Every crate is "not found. Skipping...", and the build
  still succeeds.

Locally at `b1bf2cf`, generated default crates make `Vec::` complete
`capacity` and `clear`; without them it completes nothing.

## What Changes

- A script generates the default crates with `syn-file-expand-cli` 0.2.0 from
  the toolchain in
  [`wasm/rust-analyzer/rust-toolchain.toml`](../../../../wasm/rust-analyzer/rust-toolchain.toml),
  the one the Rust Analyzer wasm is built with (Rust 1.68.0-nightly). User
  programs compile with Rust 1.68.0 (design.md, "The toolchain comes from
  `wasm/rust-analyzer/rust-toolchain.toml`"). Upstream pairs the same analyzer
  with default crates from about Rust 1.60.
- `generate-crates` runs `cargo fetch --locked` on `server/programs` first, and
  fails, naming the crate, when it cannot generate a supported crate.
- Vercel restores the default crates from Remote Cache, keyed on their inputs,
  and generates the supported crates in every build. The Docker image
  generates both. A `client-v2-standalone` compose profile runs the client
  without the server.
- No file is uploaded by hand and no generated file is committed.
- No slice under `features/` or `widgets/` changes. No telemetry event is
  added, renamed, or removed.

## Capabilities

### New Capabilities

- `client-v2-editor-crates`: which crate files every deployment serves under
  `/crates/`, and how they are produced from pinned inputs.

### Modified Capabilities

None.

## Impact

- [`client-v2/scripts/`](../../../../client-v2/scripts/): `generate-default-crates.mjs`;
  `generate-crates.mjs` gains the fetch, the failure on a missing crate, and a
  key that skips unchanged inputs. `vercel-install.sh` caches the default
  crates as it does the wasm packages.
- [`client-v2/package.json`](../../../../client-v2/package.json): `generate` runs
  `generate-default-crates`.
- [`client-v2/Dockerfile`](../../../../client-v2/Dockerfile),
  [`compose.yaml`](../../../../compose.yaml),
  [`.dockerignore`](../../../../.dockerignore): the image bakes every crate file;
  the `client-v2-standalone` profile.
- [`client-v2/docs/deploy-client-vercel.md`](../../../../client-v2/docs/deploy-client-vercel.md):
  the build cache section.
- Users: the editor resolves the standard library and the supported crates.
  The default crates add 13.3 MB to the first editor load, 0.99 MB at brotli
  11; what Vercel transfers is not measured.
- Vercel: a miss on the default crates adds about 2 min; the supported crates
  add 20 to 26 s to every build.
- Out of scope:
  - Changing the Rust Analyzer wasm or its toolchain.
  - Shrinking `core.rs` (10.3 MB).
  - `mpl-token-metadata`, which `generate-crates` skips on purpose.
  - Moving the build server to another Solana release.
  - A 404 for a missing `/crates/` file (design.md, "No 404 for a missing
    crate file").
  - An editor message when the crate files fail to load.
  - `yarn setup` keeping the stub Rust Analyzer after `wasm/stub-packages.sh`;
    `yarn install --check-files` replaces it.
  - Turborepo's Remote Cache in place of `vercel-install.sh`'s cache code,
    deferred until `client-v2` moves to Next.
