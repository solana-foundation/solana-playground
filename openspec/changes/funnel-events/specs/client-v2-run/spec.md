# Spec Delta

## Purpose

What the product reports when a user runs the project's tests or its client
script, so the funnel can count programs that are used after a deploy and
how often their tests pass.

Every scenario is marked `(manual)`: events leave the browser only through
GA4, which no Playwright test reads. A unit test through the memory provider
holds each one, and each can be checked in GA4's DebugView.

## ADDED Requirements

### Requirement: The slice declares the run events

The `features/run` slice SHALL declare, describe, and export through its
`index.ts` the events of this spec in `model/telemetry.ts` with prefix
`run`, registered in `shared/lib/telemetry/prefixes.ts`. The `run` and
`test` commands SHALL send them through that tracker without a scope.

#### Scenario: The tracker is the only sender (manual)

- **WHEN** a `test` command finishes
- **THEN** the event goes through `features/run`'s tracker, and the memory
  provider records it with no scope

### Requirement: A finished run is counted with its outcome

`processCommon` in `commands/run-and-test/run-and-test.ts`, which the `run`
and `test` commands share whether typed in the terminal or started from the
explorer, SHALL send `run_finished {kind, outcome}` once the run ends: `test` has
run every file it was given, or `run` has run its scripts until one failed. `kind` is `test` or `client`. `outcome` is `failed` when any
file failed, else `passed`. `PgJsRuntime.execute` in
`utils/js-runtime/js-runtime.ts` SHALL report whether a file failed: a test
file when mocha reports a failure, a client script when it throws an error
it does not catch.

#### Scenario: Tests pass (manual)

- **WHEN** a user runs `test` and every test passes
- **THEN** `run_finished` is sent once with `kind: "test"` and
  `outcome: "passed"`

#### Scenario: A test fails (manual)

- **WHEN** a user picks "Test All" on the `tests` folder and one assertion
  fails
- **THEN** `run_finished` is sent once with `kind: "test"` and
  `outcome: "failed"`

#### Scenario: A client script throws (manual)

- **WHEN** a user runs `run` and the script throws
- **THEN** `run_finished` is sent once with `kind: "client"` and
  `outcome: "failed"`

### Requirement: A run that cannot run the user's code is counted

`processCommon` SHALL send `run_errored {kind, reason}` in place of
`run_finished` when it throws. `reason` is `busy` when `PgJsRuntime.execute`
refused because another run of tests or a client was in progress, told by a
typed error, else `other` (a missing file, a file that is not a script, a
test file without `describe`, a forbidden global, or an import that could
not load).

#### Scenario: A second run while tests run (manual)

- **WHEN** a user picks "Run" on a client file in the explorer while tests
  are running
- **THEN** `run_errored` is sent with `kind: "client"` and `reason: "busy"`,
  and no `run_finished` is sent for it

#### Scenario: A file that does not exist (manual)

- **WHEN** a user types `run missing.ts`
- **THEN** `run_errored` is sent with `kind: "client"` and `reason: "other"`

### Requirement: No run event carries code or output

No event of the slice SHALL carry a file name, code, test names, terminal
output, or an error message.

#### Scenario: A failing test's message (manual)

- **WHEN** a test fails with a message that quotes an address
- **THEN** no parameter of `run_finished` contains that message
