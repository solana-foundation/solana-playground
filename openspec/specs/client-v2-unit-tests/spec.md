# client-v2-unit-tests Specification

## Purpose

Where a `client-v2` module's unit tests live, what an in-source test block may
contain and must not do, and how the unit suite collects test files and blocks,
so that a test of an internal needs no export and no test code reaches users.

## Requirements

### Requirement: A mock-free unit test lives in its module

A unit test that exercises one module and mocks no module SHALL sit at the end
of that module, in a block guarded by `import.meta.vitest`. A test that mocks a
module, renders React, spans several modules, targets a `.mjs` module,
re-imports its own module after resetting the module registry, or is a second
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

### Requirement: An in-source block adds nothing to the module's imports

A block SHALL take the test API from `import.meta.vitest`, SHALL load any other
value it needs with a dynamic import inside a setup hook, SHALL refer to any
other type with an inline `import()` type, and SHALL NOT add or widen a static
import of the module. A block SHALL NOT contain a top-level `await`.

#### Scenario: A reviewer diffs a module that gained a block (manual)

- **WHEN** a module gains a block
- **THEN** the diff of that module is one appended block and no change above it

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

- **WHEN** `yarn test-unit src/shared/lib/ids.ts` runs
- **THEN** the tests in that module's block run, and no other test runs

#### Scenario: The deleted test file's path (manual)

- **WHEN** `yarn test-unit` is given the path of a test file that was moved
  into its module
- **THEN** the run reports no test file found

#### Scenario: The marker in a comment (manual)

- **WHEN** a module without tests mentions `import.meta.vitest` in a comment
- **THEN** `yarn test-unit` fails on that file with "No test suite found"
