# Proposal

## Why

The six `wasm/<name>/pkg` packages compiled from Rust had stand-ins (the wasm
stubs) that any path could install, so a local build, a CI run, or a bundle
snapshot could measure or ship something no deployment serves. HOO-2167 makes
the real packages the default everywhere and the stubs an explicit opt-in; no
requirement records that contract, so nothing stops the next change from
quietly reintroducing a stub on a default path.

## What Changes

- Every default path builds, installs, or requires the real wasm packages:
  `yarn setup` and `yarn build`, the scripts that serve, build, or test the
  app, the compose `v2` and `v2-prod` profiles, the Vercel install and build,
  and CI on pushes to `master` and on every pull request.
- The stubs are written only under `USE_WASM_STUBS=true`, the exact string,
  which the `:with-stubs` scripts and the dispatch-only `client-v2-with-stubs.yml`
  set. `wasm/stub-packages.sh` is not gated itself; its only caller is.
- A deployment never carries a stub: the Vercel install refuses the variable,
  and the build ends with a check that fails a bundle that carries a stub or
  lacks any of the six real packages.
- `bench/BUNDLE.md` measures the real packages: `yarn bundle:info` refuses a
  build that lacks one, and the snapshot test skips on a stub run instead of
  failing it.
- The behaviour exists in #34; this change records it, it adds no code.
- No telemetry: the change touches no slice under `features/` or `widgets/`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-build`: adds five requirements: the real packages on every
  default path, no stub in a deployment, the stub opt-in by the exact variable,
  scripts that refuse unrequested stubs, and a bundle snapshot measured on the
  real packages. "The committed bundle size snapshot stays current" is left as
  it is; the snapshot rule is its own requirement.

## Impact

- User-visible: every deployment, CI run, compose stack, and bundle snapshot
  reflects the Rust intellisense and the `solana`, `anchor`, `spl-token`, and
  `sugar` commands users get, never a stand-in that throws or answers empty.
- Developers need a Rust toolchain for `yarn setup`; without one,
  `yarn setup:with-stubs` remains, by name.
- Code: `client-v2/package.json` scripts, `client-v2/scripts/setup-wasm.sh`,
  `wasm-stubs.sh`, `wasm-stubs.mjs`, `vercel-install.sh`, `vercel.json`,
  `compose.yaml`, the `client-v2*.yml` workflows, and
  `wasm/stub-packages.sh`, all as #34 leaves them.
- Out of scope: making the three build routes (`wasm/build.sh` directly, the
  compose `wasm` image, and `build_wasm_packages` on Vercel and CI) produce
  byte-identical output; gating `wasm/stub-packages.sh` itself; generating the
  rust-analyzer default crates in the CI `e2e` job; `client/` and `server/`.
