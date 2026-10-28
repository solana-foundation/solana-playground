# Spec Delta

## ADDED Requirements

### Requirement: The committed bundle size snapshot stays current

`client-v2/bench/BUNDLE.md` SHALL hold the count, raw and gzipped bytes of the
production build's JavaScript and CSS files, where the JavaScript files are
`build/static/js/*.js` and the Monaco workers `build/*.worker.js`; the
`build/*.module.wasm` files SHALL NOT be measured. It SHALL hold a gzipped
size row for each named chunk, one for each worker keyed `worker:<name>`, and
one `other chunks` row with the count and gzipped sum of every other chunk.
A fresh size cell within 11 KiB of the committed cell
(`DISPLAY_STEP_TOLERANCE_BYTES`) SHALL keep the committed value. The rule
compares rounded cells, so real growth of up to about two display steps can go
unrecorded. `yarn test-build` SHALL fail when the file differs from a fresh
measurement, naming `yarn bundle:info`, which regenerates it, and when
`build/` is absent.

#### Scenario: A rebuild of the same commit (manual)

- **WHEN** `yarn bundle:info` runs on a second build of the commit the
  snapshot was generated from
- **THEN** `bench/BUNDLE.md` is unchanged and `yarn test-build` passes

#### Scenario: A chunk grows without a refreshed snapshot (manual)

- **WHEN** a chunk grows until its fresh gzipped cell is more than 11 KiB
  from its committed cell, and `bench/BUNDLE.md` is not regenerated
- **THEN** `scripts/bundle-info.build-test.mjs` fails under `yarn test-build`
  and its message names `yarn bundle:info`

### Requirement: A pull request receives its bundle change as a comment

On a pull request, the build workflow SHALL render the difference between the
base branch's committed snapshot and the pull request's fresh measurement,
under a heading that names the pull request's head commit, listing every added
or removed row and every row with a changed cell. Each fresh size cell SHALL be
rendered with the base branch's cell as its committed value, so a size cell
changes only when it moves more than 11 KiB from the base branch's cell.
A workflow that runs on the completed CI run SHALL post it as one comment on
the pull request, updated in place by later runs, including for a pull request
from a fork.

#### Scenario: A pull request with no size change (manual)

- **WHEN** every fresh size cell is within 11 KiB of the base branch's cell, no
  row was added or removed, and no non-size cell changed
- **THEN** the comment says "No row moved past the 11 KiB tolerance." and holds
  the full table in a collapsed section

#### Scenario: A pull request with a stale snapshot (manual)

- **WHEN** the build tests fail because `bench/BUNDLE.md` is stale
- **THEN** the comment is still posted, with a line saying the snapshot is out
  of date

### Requirement: The production bundle carries no test helper or test runner module

The production bundle SHALL contain no module under `client-v2/src/test-utils/`
and no module from the `vitest` or `@vitest/*` packages. `yarn test-build`
SHALL fail when one is present, naming the module, and when the module list
`bundle-info/bundle-modules.json` is absent or older than `build/index.html`.
The module list SHALL be written outside `build/`, so a deployment does not
serve it.

#### Scenario: A test helper imported and used (manual)

- **WHEN** a module under `src/` imports a function from
  `src/test-utils/stored-values.ts` statically, calls it, and the production
  build runs
- **THEN** `scripts/bundle-modules.build-test.mjs` fails under
  `yarn test-build` and names `./src/test-utils/stored-values.ts`

#### Scenario: A clean build (manual)

- **WHEN** the production build runs on `master`
- **THEN** `scripts/bundle-modules.build-test.mjs` passes
