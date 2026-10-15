# Design

## Context

Read at
[`b1bf2cf`](https://github.com/hoodieshq/solana-playground/commit/b1bf2cfc374b39c6bf016e638baa9b4ffc913490):

- [`rust-analyzer.ts`](../../../client-v2/src/components/Editor/Monaco/languages/rust/rust-analyzer/rust-analyzer.ts)
  fetches the default crates on every editor start (`loadDefaultCrates`) and a
  `.rs` plus `.toml` per dependency (`loadDependency`). `PgCommon.fetchText`
  throws on a non-OK response.
- [`craco.config.js`](../../../client-v2/craco.config.js) lists
  `public/crates` at compile time (`defineFromPublicDir`), so the files must
  exist before `craco build`.
- [`generate-crates.mjs`](../../../client-v2/scripts/generate-crates.mjs) runs
  in `yarn generate` and expands each supported crate from
  `$CARGO_HOME/registry/src/index.crates.io-*`. `vercel-install.sh` exports its
  `CARGO_HOME` only to itself, so `yarn build` reads `~/.cargo`.
- Vercel answers any missing path, `/no-such-file.xyz` included, with
  `index.html` and HTTP 200. The build output has no `404.html`.

Measured on macOS at `b1bf2cf`, one run each:

| Step | Result |
| ---------------------------------------------------------------------- | ------------------------- |
| `syn-file-expand-cli` 0.2.0 install | 14 s |
| `std`, `alloc`, `core` from `nightly-2022-12-12` with 0.2.0 | 2.1 MB, 1.0 MB, 10.3 MB |
| `cargo fetch --locked` of `server/programs` into an empty `CARGO_HOME` | 796 MB, about 420 MB peak |
| `generate-crates` after that fetch | 85 files, 0 skipped |
| The same fetch on a filled registry | 0.25 s |

### Upstream reference

Every comparison with upstream is against these files. `beta.solpg.io` serves
them from Amazon S3, so no commit pins them; the SHA-256 does. Neither
upstream's
[`solana-playground`](https://github.com/solana-playground/solana-playground/commit/3fb888f38961738635e6b971b3fd724fc86ce198)
at `3fb888f` nor
[`assets`](https://github.com/solana-playground/assets/commit/7fa9f326867f48f7e3abf47494d9a1849beff01f)
at `7fa9f32` contains them. Their format is `syn-file-expand-cli` output;
`Last-Modified` dates the upload, not the generation.

| File | Bytes | SHA-256 | `ETag` | `Last-Modified` |
| -------------------------------------------- | --------- | ------------------------------------------------------------------ | ---------------------------------- | ----------------------------- |
| `https://beta.solpg.io/crates/core.rs` | 2,879,532 | `8efecd687c73dc8c1c2dc6972da42ef33568bf9e1b532a4f9da53bd726c1d764` | `187e6243e4e0a5b1699cd18815ef3a66` | Fri, 21 Aug 2026 18:42:20 GMT |
| `https://beta.solpg.io/crates/alloc.rs` | 815,113 | `83ce2a8d81dfa75b7c2248e55ae71799f39dbc7870eb360f7553d5562fb99078` | `31d1fe7d4c8d9af37190e9dac52d739e` | Fri, 21 Aug 2026 18:42:18 GMT |
| `https://beta.solpg.io/crates/std.rs` | 1,509,878 | `c1c2b7cbf5f597e1bdc89fe2cd2eb916c48fc941aa00de20031c123357f8045f` | `a3de96aced38def4f40687718f6cad32` | Fri, 21 Aug 2026 18:42:23 GMT |
| `https://beta.solpg.io/crates/versions.json` | 728 | `36a5637374859fd5ee9facab6c91666c4ef164e14048e3ff33849d35b56fcfe5` | `09d9d359d686cb3c8669de38f4edcb16` | Fri, 21 Aug 2026 18:42:24 GMT |

## Goals / Non-Goals

**Goals:**

- One command produces all of `public/crates` from pinned inputs, locally and
  on Vercel.
- A build on unchanged inputs runs no Rust tool for the default crates.

**Non-Goals:**

- Generating crates in the browser or on the build server.
- Matching upstream's default crates byte for byte.

## Decisions

### `syn-file-expand-cli` 0.2.0 for the default crates only

0.3.0 depends on `syn` 2, which removed the unstable `box` expression that
`std` uses (eighteen files of the 1.61 `std`). 0.2.0 depends on `syn` 1 and
expands all three. The supported crates keep 0.3.0. Each release installs into
its own `--root` under the cargo home, so neither shadows the other on `PATH`.

- Alternative: 0.2.0 for every crate. It changes 85 working files, unmeasured.

### The toolchain comes from `wasm/rust-analyzer/rust-toolchain.toml`

The default crates must match the analyzer that reads them, so the generator
installs the `channel` of
[`wasm/rust-analyzer/rust-toolchain.toml`](../../../wasm/rust-analyzer/rust-toolchain.toml)
with `rust-src`: `nightly-2022-12-12`, Rust 1.68.0-nightly. User programs
compile with Rust 1.68.0: Solana 1.17.34's `cargo-build-sbf`
[pins platform-tools v1.37](https://github.com/anza-xyz/agave/blob/77daab497df191ef485a7ad36ed291c1874596e5/sdk/cargo-build-sbf/src/main.rs),
which
[builds Solana's Rust `solana-tools-v1.37`](https://github.com/anza-xyz/platform-tools/blob/390112a3f6d25e17662e83bf73d73f3d483b556e/build.sh),
whose [`src/version`](https://github.com/solana-labs/rust/blob/solana-tools-v1.37/src/version)
reads `1.68.0`.

Upstream pairs the same analyzer with default crates whose newest
stabilization is Rust 1.60, so an API stabilized in 1.61 to 1.68, such as
`std::array::from_fn`, shows as unknown although it compiles.

- Alternative: generate from 1.60 to match upstream. The output still differs
  from upstream's (`std` 2.0 MB against 1.5 MB, `core` 9.4 MB against 2.9 MB;
  upstream's flags are unknown), so it matches neither upstream nor our
  compiler.

### Flags

```sh
--loopify --cfg-true-by-default --unset-cfg test                  # all three
--unset-cfg "all(target_arch=x86_64,target_feature=avx512f)"      # core only
```

Without `--unset-cfg test`, `core` reaches test files `rust-src` does not
ship. In `core`, `core_simd::masks::mask_impl` picks one of two `#[path]` files
through `cfg_attr`; with every cfg true both apply and the tool stops.
Unsetting the AVX-512 variant keeps `full_masks.rs`.

- Alternative: `--full-crate-tree` (9.3 MB) also passes, but keeps both
  modules instead of naming the dropped one.

### Brotli copies

The generator also writes `<name>.rs.br`: brotli quality 11, text mode, window
24 (the largest browsers decode), through the `zlib` of the Node `.nvmrc`
pins. Two runs at `e247abb5` gave the same SHA-256 for every file.

| Default crate | `.rs` | gzip -9 | brotli 11 (`.rs.br`) | zstd -19 | xz -9 |
| --- | --- | --- | --- | --- | --- |
| `core` | 10,262,337 | 903,315 | 621,514 | 656,884 | 669,036 |
| `std` | 2,071,630 | 333,191 | 240,668 | 249,139 | 248,772 |
| `alloc` | 1,000,115 | 177,220 | 123,896 | 129,804 | 129,256 |

`rust-analyzer.ts` fetches the `.rs` files until a task serves the `.br`
copies with `Content-Encoding: br`. Vercel's own on-the-fly brotli level is
undocumented.

- Alternative: zstd or xz. No smaller, and browsers need a shipped decoder.
- Alternative: gzip through `DecompressionStream`. 43% larger than brotli 11.

### Registry fetch and key files

`generate-crates` runs `cargo fetch --locked --manifest-path
../server/programs/Cargo.toml` against the `CARGO_HOME` it reads.

Each generator writes a SHA-256 of its inputs and exits when it matches;
`--key` prints it. `.crates-key` covers the script and
`server/programs/Cargo.lock`; `.default-crates-key` covers the script, the
toolchain file, and Node's brotli version. The keys are what let a restored
`public/crates` survive `yarn build`, which runs both generators again.

### Remote Cache in `vercel-install.sh`

The install script restores the default crates from a Remote Cache tar keyed
on their generator's key; on a miss it generates and uploads before `yarn
install`, reusing `remote_has`, `remote_fetch`, and `remote_upload`. The
supported crates are generated in every build with the Rust in Vercel's image.

On Vercel's 4 cores, preview `dpl_DHaCX3RVDt1xfDXgffFETouqGBti` at `7c23f8a1`:
a miss took 4 min 19 s, about 2 min of it the default crates; hits took 2 min
10 s to 2 min 44 s, the supported crates 20 to 26 s of that.

- Alternative: cache the supported crates too. Tested locally (a 444 KB tar),
  but `rustup`, a pinned toolchain, and about 30 lines of shell to save 20 to
  26 s.
- Alternative: commit the output to the assets submodule. 12 MB of generated
  text, and a hand commit per input change.

### No 404 for a missing crate file

The fallback to `index.html` comes from a route outside `vercel.json`
(`@vercel/routing-utils` shows the SPA rewrite does not match; there is no
`x-matched-path`). A rewrite cannot set a status, and a 404 needs the legacy
`routes` array in place of every rewrite and header. Instead every requested
crate exists, and `generate-crates.mjs` fails the build on a missing one.

## Risks / Trade-offs

- [A miss on the default crates adds the toolchain download and their
  expansion, about 2 min] → Only when an input changes.
- [Vercel's image has no `rustup`] → `ensure_rustup` in `vercel-install.sh`
  installs it before generating.
- [`yarn build` runs without the install step's Rust and finds none] → Both
  generators throw when `VERCEL` or `CI` is set (`skipWithoutTool`), so the
  build fails instead of shipping without crates. Locally they warn and skip.
- [`core.rs` is 10.3 MB] → An 8.5 MB `core.rs` from Rust 1.61 transferred as
  0.78 MB locally, and indexing finished within 30 s. The shipped 1.68 file and
  a slow machine are not measured.
- [Two runs produce different bytes] → Not observed: at `ec6f2b0d`, every
  crate file had the same SHA-256 on macOS, Vercel, and Docker.

## Migration Plan

1. Land the change. Preview `dpl_DHaCX3RVDt1xfDXgffFETouqGBti` at `7c23f8a1`
   was the first to miss and generate.
2. Rollback: revert the change.

## Open Questions

None.
