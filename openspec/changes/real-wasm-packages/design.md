# Design

## Context

See proposal.md, "Why". The code is in #34. The stubs and the real packages
share the folders `wasm/<name>/pkg`, and `client-v2/package.json` installs
them as `file:` packages, which yarn 1 copies again only when the folder in
`node_modules` is missing. So a stub can sit in either place, and each check
below reads the place its path consumes.

## Goals / Non-Goals

**Goals:**

- One switch for the stubs, read the same way by every shell and Node caller.
- A stub fails a check on every path that deploys, measures, or serves the app,
  with a message that names the cause and the command that fixes it.

**Non-Goals:**

- Byte-identical packages across the three build routes (`wasm/build.sh`
  directly, the compose `wasm` image, `build_wasm_packages` on Vercel and CI).
  All three build the same sources; the routes differ in how they pin
  `wasm-bindgen`.
- Gating `wasm/stub-packages.sh` itself.

## Decisions

- **One variable, the exact string `true`.** `wasm-stubs.sh` (POSIX, sourced
  by `Makefile.vercel`) and `wasm-stubs.mjs` declare it; a test compares the
  two and the stub writer. Any other value means the real packages, so a stray
  `1` or `yes` cannot opt in. Alternative: a truthiness check, rejected
  because it turns an accidental value into stubs.
- **The gate is the caller, not `wasm/stub-packages.sh`.** The script writes
  stubs when run, and its header says so; `setup-wasm.sh` is its only caller.
  Alternative: the script reads the variable itself, rejected because a
  developer who runs it by hand has asked for stubs.
- **Each check reads what its path consumes.** The serve and test scripts read
  `node_modules` (the guard), the deploy reads the built bundle
  (`check-build`, looking for the stub text and each package's wasm-bindgen
  module), and the fast deploy reads both `wasm/*/pkg` and `node_modules`.
  Alternative: one check on `wasm/*/pkg`, rejected because an install keeps an
  old stub copy in `node_modules`.
- **The snapshot test skips on a stub run.** The snapshot measures the real
  packages, so a stub build cannot reproduce it; failing would make the stub
  workflow red by construction. `bundle:info` refuses a stub build, so a stub
  measurement cannot be written by accident.
- **CI fails on an unexpected skip.** A called workflow concludes `success`
  when its jobs are skipped, so `reusable-client-v2.yml` ends with a `gate`
  job that requires `wasm` to succeed, or to be skipped only on a stub run.

## Risks / Trade-offs

- [A hand-run `stub-packages.sh` leaves stubs in `wasm/*/pkg` that install
  later] → the guard and `check-build` catch them downstream; `setup-wasm.sh`
  removes them before a real build.
- [The rust-analyzer `@real-wasm` spec needs the default crates, which the CI
  `e2e` job does not generate] → tracked as a finding on #34, outside this
  change's requirements.
- [The real packages need a Rust toolchain for `yarn setup`] →
  `yarn setup:with-stubs` remains, by name.
