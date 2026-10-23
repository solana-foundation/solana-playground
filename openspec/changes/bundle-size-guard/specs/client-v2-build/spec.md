# Spec Delta

## ADDED Requirements

### Requirement: The repository carries a snapshot of the production bundle's sizes

`client-v2/bench/BUNDLE.md` SHALL list, for the production build, the count,
raw bytes and gzipped bytes of the JavaScript files and of the CSS files, and
one row per JavaScript chunk keyed by its chunk id with its gzipped size. A
cell SHALL be rounded to a display step and SHALL keep its committed value
while a fresh build rounds within one step of it. `yarn bundle:info` SHALL
regenerate the file from `build/`.

#### Scenario: A build within rounding noise (manual)

- **WHEN** `yarn bundle:info` runs on a build whose chunks differ from the
  committed snapshot by less than one display step each
- **THEN** the regenerated file is byte-identical to the committed one

#### Scenario: A chunk grows past one step (manual)

- **WHEN** `yarn bundle:info` runs on a build in which one chunk's gzipped
  size grew by more than one display step
- **THEN** that chunk's row shows the new value and every other row is
  unchanged

### Requirement: The build tests fail when the committed snapshot is stale

`yarn test-build` SHALL measure `build/` and SHALL fail when the committed
`client-v2/bench/BUNDLE.md` is not byte-identical to that measurement, naming
`yarn bundle:info` as the remedy, and SHALL fail when `build/` is absent.

#### Scenario: A pull request changes a chunk without refreshing the snapshot (manual)

- **WHEN** a pull request changes one chunk's gzipped size by more than one
  display step and leaves `bench/BUNDLE.md` as it was
- **THEN** `scripts/bundle-info.build-test.mjs` fails under `yarn test-build`,
  in the "Build tests" step of the build workflow, and its message names
  `yarn bundle:info`

#### Scenario: A pull request refreshes the snapshot (manual)

- **WHEN** the same pull request commits the regenerated `bench/BUNDLE.md`
- **THEN** the test passes

### Requirement: A pull request receives its bundle change as a comment

The build workflow SHALL render, on a pull request, the difference between the
base branch's committed snapshot and the pull request's fresh measurement,
listing rows that moved by more than one display step and counting rows that
moved within it, and SHALL post it as one comment on the pull request that
later runs update in place.

#### Scenario: A pull request with no size change (manual)

- **WHEN** a pull request's fresh measurement differs from the base branch's
  committed snapshot by at most one display step per row
- **THEN** the comment says no chunk size changed and holds the full table in
  a collapsed section

#### Scenario: A pull request with a stale snapshot (manual)

- **WHEN** the build tests fail because `bench/BUNDLE.md` is stale
- **THEN** the comment is still posted, with a line saying the snapshot is
  out of date

#### Scenario: A pull request from a fork (manual)

- **WHEN** the pull request comes from a fork, whose CI token cannot write
  comments
- **THEN** the comment is still posted, by a workflow that runs in the base
  repository on the completed CI run

### Requirement: The production bundle carries no test helper or test runner module

The production bundle SHALL contain no module under `client-v2/src/test-utils/`
and no module from the `vitest` or `@vitest/*` packages. `yarn test-build`
SHALL fail when one is present, naming the module, and SHALL fail when the
module list the build writes is absent.

#### Scenario: A test helper imported statically (manual)

- **WHEN** a module under `src/` gains a static import of
  `src/test-utils/stored-values.ts` whose export it calls, and the production
  build runs
- **THEN** `scripts/bundle-modules.build-test.mjs` fails under
  `yarn test-build` and names `src/test-utils/stored-values.ts`

#### Scenario: A clean build (manual)

- **WHEN** the production build runs on `master`
- **THEN** the test passes and `build/bundle-modules.json` lists no module
  under `src/test-utils/` and none from `vitest`
