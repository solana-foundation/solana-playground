# client-v2-build Specification

## Purpose
What the production build of `client-v2` must produce and within which limits,
so that it completes on the standard deploy machine and its output behaves as
the development build does.

## Requirements

### Requirement: The production build fits in 8 GB of memory

A cold production build SHALL complete with a peak memory use below 8 GB,
summed over every process the build starts, with the `NODE_OPTIONS` the
deployment sets.

#### Scenario: A cold build on the standard deploy machine (manual)

- **WHEN** a preview deployment builds the branch without a build cache on
  Vercel's standard build machine
- **THEN** the build completes, and the build log reports no "Out of Memory"
  event

#### Scenario: A cold build measured locally (manual)

- **WHEN** the production build runs with an empty `node_modules/.cache` and
  the deployment's `NODE_OPTIONS`, and the summed memory of its processes is
  sampled
- **THEN** the peak is below 8 GB

### Requirement: Minification keeps the names of `_Pg` classes

The minified production bundle SHALL keep the name of every class and function
whose name starts with `_Pg`, because change events are named after it. CI
SHALL fail when the built bundle lacks one of those names.

#### Scenario: The bundle carries the decorator class names (manual)

- **WHEN** CI builds the production bundle
- **THEN** a CI step finds `_PgConnection` and `_PgProgramInfo` as names in
  the built JavaScript, and fails the run when either is missing

#### Scenario: Dependent change events in the production build (manual)

- **WHEN** the production build is served and the connection's endpoint is
  changed in settings from Devnet to Testnet
- **THEN** the cluster label in the bottom bar changes to Testnet, and the tab
  does not freeze in a loop of change events

### Requirement: Minified output stays within the production browser floor

The minifier SHALL emit no syntax newer than the production `browserslist`
allows, and SHALL take its target from that list, not from a list of its own.

#### Scenario: The floor changes (manual)

- **WHEN** a reviewer reads the build configuration after the production
  `browserslist` is raised
- **THEN** the minifier's target follows it with no second edit

#### Scenario: A browser at the floor (manual)

- **WHEN** the production build is opened in the oldest Safari the production
  `browserslist` allows
- **THEN** every JavaScript chunk loads without a syntax error in the console

### Requirement: Type checking and linting gate the merge, not the build

The production build SHALL NOT run the type check or ESLint. CI SHALL run both
on every pull request, `yarn run check` SHALL run both, and the development server
SHALL keep reporting type errors in its overlay.

#### Scenario: A type error in a pull request (manual)

- **WHEN** a pull request adds a type error
- **THEN** the production build still completes, and the `test-types` step in
  CI fails the pull request

#### Scenario: A type error before a push (manual)

- **WHEN** a developer with the pre-push hook enabled pushes a commit with a
  type error
- **THEN** `yarn run check` fails and the push stops

#### Scenario: A type error in development (manual)

- **WHEN** the development server is running and a file gains a type error
- **THEN** the overlay shows the error

### Requirement: The production bundle carries no in-source test code

The production bundle SHALL contain no in-source test block. CI SHALL fail,
through the build tests that read `build/`, when any test title from any
block is found in the built JavaScript.

#### Scenario: The bundle is checked after the build (manual)

- **WHEN** CI builds the production bundle and runs the build tests
- **THEN** the build test collects the test titles of every block under `src/`
  and fails, naming the chunk, the title, and the module, when a title is in a
  file under `build/static/js`

#### Scenario: A block in the development bundle (manual)

- **WHEN** the development server serves a module that carries a block
- **THEN** the served JavaScript holds none of the block's test titles

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
