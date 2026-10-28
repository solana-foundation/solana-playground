## ADDED Requirements

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
