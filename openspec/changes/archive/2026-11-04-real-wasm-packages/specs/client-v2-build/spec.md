# Spec Delta

## ADDED Requirements

### Requirement: Default paths build the real wasm packages

With `USE_WASM_STUBS` unset, every path that builds, serves, or tests
`client-v2` SHALL use the six real `wasm/<name>/pkg` packages compiled from
Rust: `yarn setup`, `yarn build`, the compose `v2` and `v2-prod` profiles, and
the `client-v2.yml` workflow on pushes to `master` and on every pull request.
That workflow SHALL fail when a job it requires was skipped, so a skipped wasm
build cannot pass as success.

#### Scenario: Setting up a checkout (manual)

- **WHEN** `yarn setup` runs in `client-v2/` with `USE_WASM_STUBS` unset
- **THEN** it builds the six packages from `wasm/` and installs them, and no
  `wasm/<name>/pkg/package.json` or installed copy carries the version
  `0.0.0-stub`

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

### Requirement: A deployment never carries a wasm stub

A Vercel install SHALL refuse to run when `USE_WASM_STUBS=true` is set. The
Vercel build, and the fast production deploy in `Makefile.vercel`, SHALL fail
before deploying when the bundle or the installed packages carry a stub, or
when the bundle lacks any of the six real packages.

#### Scenario: The variable set on a deployment (manual)

- **WHEN** `USE_WASM_STUBS=true` is set in a Vercel environment and a
  deployment starts
- **THEN** the install step exits non-zero, naming the variable, and nothing
  is deployed

#### Scenario: A bundle built on a stub (manual)

- **WHEN** `node scripts/wasm-stubs.mjs check-build build` runs on a build
  whose JavaScript carries the text `local dev stub`, or lacks the
  wasm-bindgen module of any of the six packages
- **THEN** it exits non-zero and names each stub file and each missing package

#### Scenario: The fast production deploy on a stub (manual)

- **WHEN** `make -f client-v2/Makefile.vercel deploy-client-to-vercel-prod-fast`
  runs with `USE_WASM_STUBS=true`, or with a `wasm/<name>/pkg/package.json`
  or `client-v2/node_modules/@solana-playground/<name>/package.json` whose
  version is `0.0.0-stub`, for any of the six packages
- **THEN** it exits non-zero before it pulls, builds, or deploys, naming the
  variable or the stub manifest

### Requirement: The wasm stubs require USE_WASM_STUBS=true

The wasm stubs SHALL be written only when `USE_WASM_STUBS` is the exact string
`true`, which the `setup:with-stubs`, `dev:with-stubs`, and
`test-e2e:with-stubs` scripts and the dispatch-only `client-v2-with-stubs.yml`
workflow set. Any other value SHALL mean the real packages.

#### Scenario: A value other than true (manual)

- **WHEN** `yarn setup` runs with `USE_WASM_STUBS=1`
- **THEN** it builds the real packages and writes no stub

#### Scenario: Setting up on the stubs by name (manual)

- **WHEN** `yarn setup:with-stubs` runs
- **THEN** each of the six `wasm/<name>/pkg` folders holds a stub with the
  version `0.0.0-stub`, and no Rust is compiled

#### Scenario: The stub workflow (manual)

- **WHEN** `client-v2-with-stubs.yml` is dispatched by hand
- **THEN** it runs the `client-v2.yml` jobs on the stubs, leaves out the
  `@real-wasm` specs, the real-package bundle check, and the bundle snapshot
  test, and runs on no push or pull request

### Requirement: Scripts refuse stubs nobody asked for

`yarn start`, `yarn dev`, `yarn dev-cra`, `yarn build-fast`, and
`yarn test-e2e` SHALL exit before doing any work when `node_modules` holds a
wasm stub and `USE_WASM_STUBS` is not `true`, naming the stubbed packages and
the command that runs on them by request.

#### Scenario: Stubs left in node_modules (manual)

- **WHEN** `node_modules/@solana-playground` holds a package with the version
  `0.0.0-stub` and `yarn dev` runs with `USE_WASM_STUBS` unset
- **THEN** it exits non-zero, names the stubbed packages, and names
  `yarn setup` and `yarn dev:with-stubs`

#### Scenario: Real packages installed (manual)

- **WHEN** every installed `@solana-playground` package is real and
  `yarn dev` runs with `USE_WASM_STUBS` unset
- **THEN** the guard passes and the dev server starts

### Requirement: The bundle size snapshot measures the real wasm packages

`client-v2/bench/BUNDLE.md` SHALL be generated from a build on the six real
wasm packages. `yarn bundle:info` SHALL refuse to write it from a build that
lacks any of them, and the snapshot test SHALL be skipped, not failed, when
`USE_WASM_STUBS=true`.

#### Scenario: Refreshing the snapshot from a stub build (manual)

- **WHEN** `yarn bundle:info` runs on a `build/` made with stubs installed
- **THEN** it exits non-zero, names each missing real package, and leaves
  `bench/BUNDLE.md` unchanged

#### Scenario: The snapshot test on a stub run (manual)

- **WHEN** `yarn test-build` runs with `USE_WASM_STUBS=true`
- **THEN** `scripts/bundle-info.build-test.mjs` reports its test as skipped
  and the other build tests run
