# Spec Delta

## MODIFIED Requirements

### Requirement: Default paths build the real wasm packages

With `USE_WASM_STUBS` unset, every path that builds, serves, or tests
`client-v2` SHALL use the real `wasm/<name>/pkg` packages compiled from
Rust, one for each name in `WASM_PACKAGES` (`client-v2/scripts/wasm-stubs.sh`):
`yarn setup`, `yarn build`, the compose `v2` and `v2-prod` profiles, and
the `client-v2.yml` workflow on pushes to `master` and on every pull request.
That workflow SHALL fail when a job it requires was skipped, so a skipped wasm
build cannot pass as success. Neither `anchor-cli` nor `sugar-cli` SHALL be one of
the packages.

#### Scenario: Setting up a checkout (manual)

- **WHEN** `yarn setup` runs in `client-v2/` with `USE_WASM_STUBS` unset
- **THEN** it builds every package `WASM_PACKAGES` names from `wasm/` and
  installs them, and no `wasm/<name>/pkg/package.json` or installed copy
  carries the version `0.0.0-stub`

#### Scenario: No anchor-cli package (manual)

- **WHEN** `yarn setup` has run in `client-v2/`
- **THEN** no `wasm/anchor-cli` folder exists, and
  `client-v2/node_modules/@solana-playground` holds no `anchor-cli`

#### Scenario: No sugar-cli package (manual)

- **WHEN** `yarn setup` has run in `client-v2/`
- **THEN** no `wasm/sugar-cli` folder exists,
  `client-v2/node_modules/@solana-playground` holds no `sugar-cli`, and a
  production build passes `node scripts/wasm-stubs.mjs check-build build`
  without a `sugar_cli_wasm_bg` module

#### Scenario: A pull request into master (manual)

- **WHEN** `client-v2.yml` runs on a pull request
- **THEN** its `wasm` job builds the real packages, or restores them from the
  cache keyed on the `wasm/` sources, and every other job uses those packages

#### Scenario: The wasm build is skipped (manual)

- **WHEN** a condition in `reusable-client-v2.yml` skips the `wasm` job on a
  run that was not asked for stubs
- **THEN** its `gate` job fails, and so does the required `client-v2` check

#### Scenario: The compose production stand-in (manual)

- **WHEN** `docker compose --profile v2-prod up` builds and starts
  `client-v2-prod`
- **THEN** the image takes its packages from the `wasm` image, which compiles
  them, and the service builds the bundle and checks it carries the real
  packages before it serves

