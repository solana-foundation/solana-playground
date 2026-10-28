# client-v2-unit-tests Specification

## Purpose

Where a `client-v2` module's unit tests live, what an in-source test block may
contain and must not do, and how the unit suite collects test files and blocks,
so that a test of an internal needs no export and no test code reaches users.

## Requirements

### Requirement: A mock-free unit test lives in its module

A unit test that exercises one module and mocks no module SHALL sit at the end
of that module, in a block guarded by `import.meta.vitest`, under one
`describe` named after the module path from `src/` without extension, because
vitest's `fullName` carries no file path. A test that mocks a
module, renders React, spans several modules, targets a `.mjs` module, tests a
runtime module the UI move rule never touches (`src/utils/explorer`,
`src/commands/`), re-imports its own module after resetting the module
registry, is imported by the browser suite under `e2e/` (Playwright compiles
the module as CommonJS, where `import.meta` is a syntax error; its tests live
in a `<name>.test.mts` file), or is a second
test file of a module whose file-scope hooks must not apply to the module's
other tests SHALL keep a separate test file.

#### Scenario: A test of an unexported function (manual)

- **WHEN** a contributor tests a function the module does not export
- **THEN** the test is written in the module's block and the function stays
  unexported

#### Scenario: A test that mocks a module (manual)

- **WHEN** a test needs `vi.mock`
- **THEN** the test is written in a separate test file, named in the rule as
  the case that stays out

#### Scenario: A failing test names its module (manual)

- **WHEN** a test in a block fails
- **THEN** the reported name starts with the module path, such as
  `features/persistence/model/project-id > tutorialProjectId > ...`

#### Scenario: A module the browser suite imports (manual)

- **WHEN** a file under `e2e/` loads a module under `src/`, directly or through
  the imports of its imports
- **THEN** that module carries no block, its tests live in `<name>.test.mts`
  beside it, and `yarn test-api` fails naming the spec, the import, and the
  module when the imported module holds a block

### Requirement: An in-source block adds nothing to the module's imports

A block SHALL take the test API from `import.meta.vitest`, SHALL load any other
value it needs with a dynamic import inside a setup hook, SHALL refer to any
other type with an inline `import()` type, and SHALL NOT add or widen a static
import of the module. A synchronous `require()` of an untyped module MAY sit at
block top. A block SHALL NOT contain a top-level `await`.

#### Scenario: A reviewer diffs a module that gained a block (manual)

- **WHEN** a module gains a block
- **THEN** the diff of that module is one appended block and no change above
  it, except a one-line change to a comment that named the deleted test file

#### Scenario: The build-time settings script loads a module with a block (manual)

- **WHEN** the production build executes `src/settings` through `tsx` to
  define `GLOBAL_SETTINGS`
- **THEN** every module in that graph that carries a block loads, and the
  build prints the settings

### Requirement: The unit suite collects test files and in-source blocks

`yarn test-unit` SHALL run every test file matched by the suite's `include`
patterns and every block in a file under `src/**/*.{ts,tsx}` that contains
the text `import.meta.vitest`. `yarn test-unit <module path>` SHALL run that
module's block alone. The text `import.meta.vitest` SHALL appear only in a
module that carries a block, because a match without tests fails the run.

#### Scenario: One module's tests (manual)

- **WHEN** `yarn test-unit src/features/persistence/model/project-id.ts` runs
- **THEN** the tests in that module's block run, and no other test runs

#### Scenario: CI proves a block is collected (manual)

- **WHEN** CI runs the API tests
- **THEN** the collection test compares the modules that hold a block with the
  non-test files vitest lists, and fails the run naming a module vitest does
  not list or a listed module without the guard

#### Scenario: The deleted test file's path (manual)

- **WHEN** `yarn test-unit` is given the path of a test file that was moved
  into its module
- **THEN** the run reports no test file found

#### Scenario: The marker in a comment (manual)

- **WHEN** a module without tests mentions `import.meta.vitest` in a comment
- **THEN** `yarn test-unit` fails on that file with "No test suite found"

### Requirement: The test API is typed in test code only

The type check (`yarn test-types`) SHALL accept vitest's global test API
(`describe`, `it`, `expect`, `vi` and the hooks) in test code (a file matched
by the suite's `include` patterns, the suite's setup file and the shared test
helpers under `src/test-utils/`), and SHALL reject it in any other file under
`src/`, where it would throw at run time. An in-source block SHALL take the test API
from `import.meta.vitest`. The global `it` SHALL be vitest's, so `it.each`
type-checks wherever it runs.

#### Scenario: `it.each` in a test file (manual)

- **WHEN** a test file calls `it.each` on the global `it`
- **THEN** `yarn test-unit` runs each case and `yarn test-types` passes

#### Scenario: A test call in production code (manual)

- **WHEN** a non-test file under `src/` calls the global `vi` or `expect`
- **THEN** `yarn test-types` fails naming that file

### Requirement: Tests get no real cross-tab channel by default

The unit suite's setup SHALL remove the environment's `BroadcastChannel`, so
code that checks for it behaves as in a browser without one. A test that
exercises cross-tab messaging SHALL install its own fake channel in the test
file.

#### Scenario: A test that brings no channel (manual)

- **WHEN** a test drives code that opens a `BroadcastChannel` when one exists
- **THEN** no channel is opened, and the code takes its no-channel path

### Requirement: The filesystem mock matches the filesystem's signatures

The in-memory filesystem the unit suite installs in place of the browser one
SHALL be checked by the type checker against the real module's signatures for
every member it provides.

#### Scenario: The real filesystem changes a signature (manual)

- **WHEN** a member the mock provides changes its parameters or result in the
  real module
- **THEN** `yarn test-types` fails on the mock
