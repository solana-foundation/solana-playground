# Spec Delta

## Purpose

**Area:** the spec coverage report, the generated `tests.md` of each capability, and the strict gate, which
`yarn run check` and the `checks` job of `client-v2` run (CI).

How each OpenSpec scenario of `client-v2` maps to a test, at which level, and clause by clause, and how the coverage
report, the generated `tests.md` of each capability, and the per-capability strict gate check that mapping.

## ADDED Requirements

### Requirement: Every scenario is a test or is marked manual

Every `#### Scenario:` in a spec under `openspec/specs/` or an active change SHALL be checked by a test titled
`<capability>: <scenario name>`, where `<capability>` is the folder that holds the `spec.md`, or SHALL end its heading
with `(manual)`. A skipped or unwritten test (`.skip`, `.fixme`, or `.todo` on `test`, `it`, or `describe`,
`test.describe.skip` included) SHALL NOT count, and neither SHALL a test whose body calls `test.skip(` or
`test.fixme(`, whatever the arguments. A scenario under a `## REMOVED` heading of a delta SHALL owe no test. A
scenario marked `(manual)` that a test cites SHALL be reported as a conflict, and in a strict capability
`yarn spec:coverage` SHALL exit with an error on it.

#### Scenario: A scenario with a browser test

- **GIVEN** a Playwright test in `e2e/` titled with the scenario's capability and name
- **WHEN** `yarn spec:coverage` runs
- **THEN** counts the scenario as tested at the end-to-end level

#### Scenario: A scenario with neither a test nor the mark

- **WHEN** `yarn spec:coverage` runs over a scenario no test cites and whose heading has no `(manual)` mark
- **THEN** lists the scenario as uncovered, with its spec file and line

#### Scenario: A skipped test

- **WHEN** the only test titled with a scenario is a `test.skip`
- **THEN** lists the scenario as uncovered

#### Scenario: A test that skips itself in its body

- **WHEN** the only test titled with a scenario calls `test.skip(` with a condition inside its body
- **THEN** lists the scenario as uncovered

#### Scenario: A manual scenario

- **WHEN** a scenario's heading ends with `(manual)`
- **THEN** counts it as manual and asks for no test

#### Scenario: A manual scenario a test cites

- **GIVEN** a capability on the strict list
- **WHEN** a test is titled with one of its scenarios whose heading ends with `(manual)`
- **THEN** exits with an error, naming the scenario and the test as a conflict

#### Scenario: A removed scenario

- **WHEN** a scenario sits under the `## REMOVED` heading of an active change's delta
- **THEN** does not list it

### Requirement: A scenario is checked at the integration or the end-to-end level

A scenario SHALL be checked at the integration level, by a vitest file the `include` globs of
`client-v2/vitest.config.ts` collect or a `node --test` file `yarn test-api` runs, when layers or slices working together show the behaviour
without a browser. It SHALL be checked at the end-to-end level, by Playwright under `e2e/`, when it needs a real
browser with user clicks or an environment: a running validator, a connected wallet, or the real wasm CLIs. An
in-source unit block SHALL NOT cite a scenario.

#### Scenario: A scenario checked by a vitest file

- **GIVEN** a vitest file under `src/` whose `describe` is titled with the scenario's capability and name
- **WHEN** `yarn spec:coverage` runs
- **THEN** counts the scenario as tested at the integration level

#### Scenario: A scenario checked by a `.test.mts` file

- **GIVEN** a vitest file under `src/` named `<name>.test.mts` whose `describe` is titled with the scenario's capability
  and name
- **WHEN** `yarn spec:coverage` runs
- **THEN** counts the scenario as tested at the integration level

#### Scenario: A scenario checked by a node test file

- **GIVEN** a `*.test.mjs` file under `scripts/` whose `describe` is titled with the scenario's capability and name
- **WHEN** `yarn spec:coverage` runs
- **THEN** counts the scenario as tested at the integration level

#### Scenario: A scenario title in an in-source block

- **WHEN** the only `describe` titled with a scenario sits in a module's in-source block
- **THEN** lists the scenario as uncovered

#### Scenario: Review of the level a test was written at (manual)

- **WHEN** a pull request adds a test for a scenario
- **THEN** passes review only when the level matches the criteria: integration without a browser, end-to-end for
  user clicks in a real browser or a real environment

### Requirement: Each clause of a scenario is a titled step of its test

A scenario's clauses SHALL be list items that start with `**GIVEN**`, `**WHEN**`, `**THEN**`, or `**AND**`. GIVEN is
optional and SHALL come first, used only when a precondition must be stated apart from the action. An AND belongs to
the clause before it. Each clause SHALL be a step of the test, titled with the clause text, in the scenario's order.

#### Scenario: A clause wrapped over two lines

- **GIVEN** a clause whose text continues on an indented second line
- **WHEN** `yarn spec:coverage` reads the scenario
- **THEN** reads one clause, with both lines joined by a single space

#### Scenario: A test with a step for every clause

- **WHEN** a test has a step for each clause of its scenario, in order
- **THEN** lists no missing clause for the scenario

#### Scenario: A clause without a step

- **WHEN** a test has no step titled with one clause of its scenario
- **THEN** names that clause as missing for that test

#### Scenario: Steps in another order

- **WHEN** a test titles every clause but puts a THEN step before the WHEN step
- **THEN** names the clauses out of order as missing

### Requirement: A Playwright test carries its clauses as steps

A Playwright test that checks a scenario SHALL be titled `<capability>: <scenario name>` and SHALL hold one
`test.step` per WHEN, THEN, and AND clause, titled with the clause. A GIVEN SHALL be either a `test.step` in the test
or a `test.describe` titled with the clause that encloses the test, whose hook runs the precondition. Steps whose
title starts with no clause keyword SHALL be ignored.

#### Scenario: A GIVEN as an enclosing describe

- **GIVEN** a Playwright test inside a `test.describe` titled with the scenario's GIVEN clause
- **WHEN** the test's body has a step for every other clause
- **THEN** lists no missing clause for the scenario

#### Scenario: A step that names no clause

- **WHEN** a Playwright test has an extra `test.step` whose title starts with no clause keyword
- **THEN** ignores that step

### Requirement: A vitest or node test carries its clauses as nested titles

A vitest or `node --test` test that checks a scenario SHALL be a `describe` titled `<capability>: <scenario name>`
holding an optional `describe` titled with the GIVEN clause, then a `describe` titled with the WHEN clause, then one
`it` per THEN and AND clause. An AND after a GIVEN or a WHEN SHALL be a `describe` nested in the one before it. Each
precondition and action SHALL run in a hook of its `describe`. A clause step SHALL count only inside the `describe`
of the GIVEN, WHEN, or AND clause before it. A flat `it` or `test` titled `<capability>: <scenario name>` SHALL cite
its scenario, and every clause of that scenario SHALL be missing for it, because it holds no clause step.

#### Scenario: A vitest test with a nested WHEN

- **GIVEN** a `describe` for the scenario that holds a `describe` titled with the WHEN clause
- **WHEN** that `describe` holds an `it` titled with each THEN and AND clause
- **THEN** lists no missing clause for the scenario

#### Scenario: A THEN beside the WHEN

- **WHEN** an `it` titled with a THEN clause sits beside the WHEN `describe` instead of inside it
- **THEN** names that THEN clause as missing

#### Scenario: An AND after the WHEN

- **GIVEN** a scenario whose WHEN clause is followed by an AND clause and then a THEN clause
- **WHEN** a vitest test nests a `describe` titled with the AND inside the WHEN `describe`, with the THEN `it` in it
- **THEN** lists no missing clause for the scenario

#### Scenario: A flat test titled with the scenario

- **WHEN** a `node --test` file holds a `test` titled with a scenario's capability and name and no clause step
- **THEN** counts the scenario as tested and names every clause as missing for that test

### Requirement: Titles are string literals

Every scenario, step, and clause title SHALL be a string literal or a template literal without a substitution,
because the checker reads source text. A title built from a variable, a concatenation, or a substitution SHALL NOT
count as the scenario or the clause it would name.

#### Scenario: A title built from a variable

- **WHEN** a test's title is a variable that holds a scenario's capability and name
- **THEN** does not count that test for the scenario

### Requirement: Clause text matches after whitespace and emphasis are normalised

The checker SHALL compare a clause with a step title after joining wrapped lines, collapsing each run of whitespace
to one space, and removing the `**` emphasis around the keyword. Every other character, backticks included, SHALL
match exactly. A clause reworded in the spec SHALL be missing until its step is retitled.

#### Scenario: A reworded clause

- **GIVEN** a test whose steps matched its scenario
- **WHEN** a THEN clause is reworded in the spec and the test is not changed
- **THEN** names the reworded clause as missing for that test

#### Scenario: A clause with code in backticks

- **WHEN** a clause holds a path in backticks and its step title holds the same backticks
- **THEN** lists no missing clause for that step

### Requirement: An assertion clause starts with a verb

Every THEN clause, and every AND after a THEN, SHALL start with a verb after its keyword, because the clause is the
test's title verbatim. A GIVEN, a WHEN, and an AND after either SHALL keep their subject. In a strict capability,
`yarn spec:coverage` SHALL exit with an error on an assertion clause whose first word is on this closed list: the, a,
an, it, its, no, nothing, that, each, every, both, neither, one; or whose first character is a backtick. Elsewhere it
SHALL report how many such clauses each capability holds.

#### Scenario: A THEN that starts with an article in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios has a THEN clause that starts with "the"
- **THEN** exits with an error, naming the scenario and the clause

#### Scenario: An AND after a THEN that starts with a backtick in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios has an AND clause after a THEN that starts with a backtick
- **THEN** exits with an error, naming the scenario and the clause

#### Scenario: A THEN that starts with an article off the list

- **WHEN** a scenario of a capability off the strict list has a THEN clause that starts with "the"
- **THEN** counts the clause in the capability's report line and exits without an error

#### Scenario: A WHEN and its AND with a subject

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios has a WHEN clause and an AND after it that both start with "the"
- **THEN** accepts both clauses

#### Scenario: A first word the list does not name

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios has a THEN clause whose first word is not on the list
- **THEN** accepts the clause

### Requirement: The coverage report lists tests, levels, missing clauses, and duplicates

`yarn spec:coverage` SHALL report, per scenario, each test that cites it (file and title), the test's level, and the
clauses each test is missing. It SHALL list every scenario that more than one test cites, as a candidate duplicate,
and SHALL NOT fail on one. `yarn spec:coverage --strict` SHALL exit with an error when any scenario is uncovered, a
scenario only an active change adds included.

#### Scenario: Two tests cite one scenario

- **WHEN** a Playwright test and a vitest test are both titled with one scenario's capability and name
- **THEN** lists the scenario among candidate duplicates, naming both tests
- **AND** exits without an error

#### Scenario: Any uncovered scenario with the strict flag

- **WHEN** `yarn spec:coverage --strict` runs and any capability has an uncovered scenario
- **THEN** exits with an error

### Requirement: Each capability has a generated tests.md

Each capability with a `spec.md` under `openspec/specs/` SHALL have a committed `tests.md` beside it, generated from
`openspec/specs/` only. It SHALL hold one row per clause per test: clause, test file, test title, and level. A clause
the test has no step for SHALL have a row naming that test's file and title, with "missing" in place of the level. A
manual scenario SHALL have one row reading "manual"; an uncovered one, one row reading "none". The generator SHALL
delete a `tests.md` whose folder has no `spec.md`.

#### Scenario: A tested scenario's rows

- **WHEN** the generator runs over a scenario with three clauses that one test checks
- **THEN** writes three rows for it to the capability's `tests.md`, each naming the test file, the test title, and the
  level

#### Scenario: A clause without a step in tests.md

- **WHEN** the generator runs over a scenario with three clauses whose one test has a step for two of them
- **THEN** writes three rows for it, the row of the clause without a step reading "missing" in place of the level

#### Scenario: A manual scenario's row

- **WHEN** the generator runs over a scenario marked `(manual)`
- **THEN** writes one row for it to the capability's `tests.md`, reading "manual"

#### Scenario: A scenario only an active change adds

- **WHEN** an active change's delta adds a scenario to a capability
- **THEN** leaves that scenario out of the capability's `tests.md`

#### Scenario: A retired capability

- **WHEN** the generator runs over a folder under `openspec/specs/` that holds a `tests.md` and no `spec.md`
- **THEN** deletes that `tests.md`

### Requirement: CI fails on a stale tests.md

CI SHALL fail, in the job that runs the checks and without a production build, when a committed `tests.md` differs
from the generator's output or a capability lacks one, naming each file and the command that regenerates it.

#### Scenario: A test renamed without regenerating

- **GIVEN** a committed `tests.md` that names a test title
- **WHEN** the test is retitled and `tests.md` is not regenerated
- **THEN** fails the freshness check, naming the `tests.md` and the command that regenerates it

#### Scenario: A capability without tests.md

- **WHEN** a capability's folder under `openspec/specs/` has a `spec.md` and no `tests.md`
- **THEN** fails the freshness check, naming the missing file

### Requirement: A listed capability gates its scenarios

A committed list SHALL name the strict capabilities. For a listed capability, `yarn spec:coverage` SHALL exit with
an error on a scenario in `openspec/specs/` that is uncovered or whose test misses a clause, and on a listed name
with no `spec.md` under `openspec/specs/`. A capability the list does not name SHALL be reported only.

#### Scenario: An uncovered scenario in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios in `openspec/specs/` has no test and no `(manual)` mark
- **THEN** exits with an error, naming the scenario

#### Scenario: A missing clause in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** a test of one of its scenarios has no step for one clause
- **THEN** exits with an error, naming the scenario and the clause

#### Scenario: A missing clause in a capability off the list

- **WHEN** a test of a scenario in a capability off the strict list has no step for one clause
- **THEN** reports the clause and exits without an error

#### Scenario: A listed name with no spec

- **WHEN** the strict list names a capability that has no `spec.md` under `openspec/specs/`
- **THEN** exits with an error, naming the listed capability

### Requirement: A pull request cannot drop a strict capability

Given a base branch, `yarn spec:coverage` SHALL exit with an error when a capability on the base branch's strict
list is absent from the pull request's list, unless the pull request also removes that capability's `spec.md`.
Without a base branch it SHALL skip the comparison.

#### Scenario: A capability removed from the list

- **GIVEN** a base branch whose strict list names a capability
- **WHEN** the pull request's list does not name it and its `spec.md` stays
- **THEN** exits with an error, naming the dropped capability

#### Scenario: A retired capability leaves the list

- **GIVEN** a base branch whose strict list names a capability
- **WHEN** the pull request removes both the capability's `spec.md` and its line in the list
- **THEN** passes the comparison

#### Scenario: A run without a base branch

- **WHEN** `yarn spec:coverage` runs without a base branch
- **THEN** compares no strict lists

### Requirement: An active change does not gate its own scenarios

For a strict capability, a scenario an active change adds SHALL be reported and SHALL NOT fail the run. A scenario
that sits in a requirement an active change modifies SHALL be checked by its name only, not clause by clause, until
the change is archived. Both exemptions SHALL apply to the strict list only: `yarn spec:coverage --strict` SHALL
exit with an error on an uncovered scenario an active change adds, as on any uncovered scenario.

#### Scenario: A proposal adds a scenario to a strict capability

- **WHEN** an active change's delta adds a scenario to a strict capability and no test cites it
- **THEN** reports the scenario as uncovered and exits without an error

#### Scenario: A proposal adds a scenario, with the strict flag

- **WHEN** `yarn spec:coverage --strict` runs and an active change's delta adds a scenario no test cites
- **THEN** exits with an error, naming the scenario

#### Scenario: A proposal rewords a scenario of a strict capability

- **GIVEN** an active change that modifies a strict capability's requirement and rewords a clause of its scenario
- **WHEN** the scenario's test retitles its step to the reworded clause
- **THEN** checks the scenario by its name only and exits without an error
