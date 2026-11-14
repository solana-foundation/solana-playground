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
with `(manual)`. An unconditionally skipped or unwritten test SHALL NOT count: `.skip`, `.fixme`, or `.todo` on
`test`, `it`, or `describe`, `test.describe.skip` and `test.describe.fixme` included; a test whose body holds
`test.skip()` or `test.fixme()` with no argument, as a statement of the body itself; a test whose body calls
`test.skip(true, …)` or `test.fixme(true, …)` with the literal `true`; and a `node:test` call whose `skip` or `todo`
option is the literal `true` or a string. A conditionally skipped test SHALL count: an in-body
`test.skip(<condition>, …)` or `test.fixme(<condition>, …)` with any other condition, a `test.skip()` or
`test.fixme()` with no argument anywhere else in the body, such as inside an `if`, a `skip` or `todo` option holding
any other expression, and vitest's `skipIf` and `runIf`. A member call other than the skip forms this requirement
names (`skip`, `fixme`, `todo`, `skipIf`, `runIf`) and `test.step.skip` SHALL be read as its base call: `test.only`,
`describe.only`, `it.only`, `describe.concurrent`, and `it.fails` are examples. A scenario that only a `## REMOVED`
section of a delta names SHALL owe no test from the delta. A scenario marked `(manual)` that a test cites SHALL be
reported as a conflict, and in a strict capability `yarn spec:coverage` SHALL exit with an error on it.

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

#### Scenario: A test inside a skipped describe

- **WHEN** the only test titled with a scenario sits in a `test.describe.skip`
- **THEN** lists the scenario as uncovered

#### Scenario: A test inside a describe with a modifier

- **WHEN** the only test of one scenario sits in a `test.describe.only`, and the only test of a second scenario sits
  in a `test.describe.parallel`
- **THEN** counts both scenarios as tested

#### Scenario: A test that skips itself under a condition

- **WHEN** the only test titled with a scenario calls `test.fixme(browserName === "firefox", "no touch events")`
  inside its body
- **THEN** counts the scenario as tested

#### Scenario: A node test skipped without a database

- **WHEN** the only test titled with a scenario is a `node:test` call with `{ skip: !DB && "DATABASE_URL not set" }`
- **THEN** counts the scenario as tested

#### Scenario: A node test skipped with the literal true

- **WHEN** the only test titled with a scenario is a `node:test` call with `{ skip: true }`
- **THEN** lists the scenario as uncovered

#### Scenario: A vitest test skipped with skipIf

- **WHEN** the only `describe` titled with a scenario is a `describe.skipIf(!process.env.DATABASE_URL)` in a vitest
  file
- **THEN** counts the scenario as tested

#### Scenario: A test that skips itself with no condition

- **WHEN** the only test titled with a scenario calls `test.fixme()` with no argument, as a statement of its body
- **THEN** lists the scenario as uncovered

#### Scenario: A test that skips itself with the literal true

- **WHEN** the only test titled with a scenario calls `test.skip(true, "parked")` inside its body
- **THEN** lists the scenario as uncovered

#### Scenario: A zero-argument skip inside an if

- **WHEN** the only test titled with a scenario calls `test.skip()` inside `if (isLive)` in its body
- **THEN** counts the scenario as tested

#### Scenario: A manual scenario

- **WHEN** a scenario's heading ends with `(manual)`
- **THEN** counts it as manual and asks for no test

#### Scenario: A manual scenario a test cites off the strict list

- **WHEN** a test is titled with a scenario of a capability off the strict list whose heading ends with `(manual)`
- **THEN** reports the scenario and the test as a conflict and exits without an error

#### Scenario: A manual scenario a test cites

- **GIVEN** a capability on the strict list
- **WHEN** a test is titled with one of its scenarios whose heading ends with `(manual)`
- **THEN** exits with an error, naming the scenario and the test as a conflict

#### Scenario: A scenario only a removal names

- **WHEN** a scenario appears only under the `## REMOVED Requirements` heading of an active change's delta
- **THEN** asks no test for that copy of the scenario

### Requirement: A scenario is checked at the integration or the end-to-end level

A scenario SHALL be checked at the integration level, by a vitest file the `include` globs of
`client-v2/vitest.config.ts` collect or a `node --test` file `yarn test-api` runs, when layers or slices working together show the behaviour
without a browser. It SHALL be checked at the end-to-end level, by Playwright under `e2e/`, when it needs a real
browser with user clicks or an environment: a running validator, a connected wallet, or the real wasm CLIs. An
in-source unit block SHALL NOT cite a scenario. The checker SHALL take a test's level from its file's path, not from
the kind of test the file holds.

#### Scenario: A scenario checked by a vitest file

- **GIVEN** a vitest file under `src/` whose `describe` is titled with the scenario's capability and name
- **WHEN** `yarn spec:coverage` runs
- **THEN** counts the scenario as tested at the integration level

#### Scenario: A scenario checked by a `.test.mts` file

- **GIVEN** a vitest file `src/shared/lib/ids.test.mts` whose `describe` is titled with the scenario's capability and
  name
- **WHEN** `yarn spec:coverage` runs
- **THEN** counts the scenario as tested at the integration level

#### Scenario: A scenario checked by a node test file

- **GIVEN** a node test file `scripts/server-url-gate.test.mjs` whose `describe` is titled with the scenario's
  capability and name
- **WHEN** `yarn spec:coverage` runs
- **THEN** counts the scenario as tested at the integration level

#### Scenario: A scenario title in an in-source block

- **WHEN** the only `describe` titled with a scenario sits in a module's in-source block
- **THEN** lists the scenario as uncovered

#### Scenario: Review of the level a test was written at (manual)

- **WHEN** a pull request adds a test for a scenario
- **THEN** gets a review of the test's level against the criteria: integration without a browser, end-to-end for
  user clicks in a real browser or a real environment

### Requirement: Each clause of a scenario is a titled step of its test

A scenario's clauses SHALL be list items that start with `**GIVEN**`, `**WHEN**`, `**THEN**`, or `**AND**`. GIVEN is
optional and SHALL come first, used only when a precondition must be stated apart from the action. An AND belongs to
the clause before it. A later WHEN after a THEN SHALL be followed by assertion clauses of its own. A GIVEN, a WHEN,
and an AND after either is a container clause. A THEN, and an AND after a THEN, is an assertion clause. Each clause
SHALL be a step of the test, titled with the clause text: a container for a container clause, a leaf for an
assertion clause. Every clause step SHALL be written in the test's own body, or in vitest and `node --test` in the
scenario's `describe`: the checker SHALL NOT read a clause step inside a helper function the test calls. The one
exception is a Playwright GIVEN that a `test.describe` (or `test.describe.serial`) around the test carries, which
sits outside the test's body. A `test.step.skip` SHALL NOT be a step of its clause.

#### Scenario: A clause wrapped over two lines

- **GIVEN** a clause whose text continues on an indented second line
- **WHEN** `yarn spec:coverage` reads the scenario
- **THEN** reads one clause, with both lines joined by a single space

#### Scenario: A clause without a step

- **WHEN** a test has no step titled with one THEN clause of its scenario
- **THEN** names that clause as missing for that test

#### Scenario: A clause step in a helper function

- **WHEN** a Playwright test calls a helper function that holds the `test.step` titled with a THEN clause of its
  scenario
- **THEN** names that THEN clause as missing

#### Scenario: A skipped step

- **WHEN** a Playwright test titles a THEN clause of its scenario with a `test.step.skip`
- **THEN** names that THEN clause as missing

### Requirement: A clause is matched to its step by nesting

The checker SHALL match a clause to its step by one rule in both runners. A container SHALL hold the step of every
clause after it in the scenario. Reading the clauses in order, the checker SHALL keep a current container, which at
the start is the test body in Playwright and the scenario's `describe` in vitest and `node --test`. The step of a
container clause SHALL be a child of the current container and SHALL become the current container. The one exception
is a Playwright GIVEN that an enclosing `test.describe` (or `test.describe.serial`) titled with the clause carries: it
SHALL be matched there, and the current container SHALL stay the test body. The step of an assertion clause SHALL be
a child of the current container, so a leaf is a child of the container of the WHEN before it, or of the AND after
that WHEN. Inside one container, each clause SHALL take the first child with its text after the child the clause
before it took there, so the container of a later WHEN is nested in the container of the WHEN before it, after that
WHEN's leaves. A clause with no such child SHALL be missing. When a container clause is missing, the clauses under it
SHALL NOT be compared and SHALL NOT be named in the report.

#### Scenario: A THEN step beside its WHEN step

- **WHEN** a Playwright test puts the `test.step` titled with a THEN clause beside the `test.step` of its WHEN, not
  inside it
- **THEN** names that THEN clause as missing

#### Scenario: A THEN beside the WHEN

- **WHEN** an `it` titled with a THEN clause sits beside the WHEN `describe` instead of inside it
- **THEN** names that THEN clause as missing

#### Scenario: Leaves in another order

- **WHEN** a test puts the leaf of an AND clause before the leaf of the THEN clause it follows, in one container
- **THEN** names that AND clause as missing

#### Scenario: An AND after the WHEN

- **GIVEN** a scenario whose WHEN clause is followed by an AND clause and then a THEN clause
- **WHEN** a vitest test nests a `describe` titled with the AND inside the WHEN `describe`, with the THEN `it` in it
- **THEN** lists no missing clause for the scenario

#### Scenario: A later WHEN nested in the first

- **GIVEN** a scenario whose clauses are a WHEN, a THEN, a later WHEN, and a THEN
- **WHEN** a test nests the container of the later WHEN in the container of the first WHEN, after the leaf of the
  first THEN, and holds the leaf of the last THEN in it
- **THEN** lists no missing clause for the scenario

#### Scenario: A later WHEN beside the first

- **GIVEN** a scenario whose clauses are a WHEN, a THEN, a later WHEN, and a THEN
- **WHEN** a test puts the container of the later WHEN beside the container of the first WHEN
- **THEN** names the later WHEN clause as missing

#### Scenario: A missing container names one clause

- **GIVEN** a scenario whose clauses are `WHEN the page reloads`, a THEN, and an AND
- **WHEN** a test holds the leaves of the THEN and the AND in a container titled `WHEN the page reloads twice`
- **THEN** names the clause `WHEN the page reloads` as missing
- **AND** names neither the THEN clause nor the AND clause

### Requirement: A Playwright test carries its clauses as nested steps

A Playwright test that checks a scenario SHALL be titled `<capability>: <scenario name>`. Each container and each
leaf SHALL be a `test.step` titled with the clause. A GIVEN SHALL be either such a `test.step` in the test or a
`test.describe` (or `test.describe.serial`) titled with the clause that encloses the test, whose hook runs the
precondition. A THEN that is observed while its action still runs SHALL be a leaf in the WHEN container, with the
rest of the action after the leaf.

#### Scenario: A Playwright test with nested steps

- **GIVEN** a Playwright test whose body holds a `test.step` titled with the WHEN clause
- **WHEN** that step holds a `test.step` titled with each THEN clause and each AND after a THEN
- **THEN** lists no missing clause for the scenario

#### Scenario: A GIVEN as an enclosing describe

- **GIVEN** a Playwright test inside a `test.describe` titled with the scenario's GIVEN clause
- **WHEN** the test's body has a step for every other clause
- **THEN** lists no missing clause for the scenario

### Requirement: A vitest or node test carries its clauses as nested titles

A vitest or `node --test` test that checks a scenario SHALL be a `describe` titled `<capability>: <scenario name>`.
Each container SHALL be a `describe` titled with the clause, and each leaf an `it` titled with the clause. Each
precondition and action SHALL run in a hook of its `describe` when it has something to run; a GIVEN whose
precondition is a constant fixture has no hook. A flat `it` or `test` titled `<capability>: <scenario name>` SHALL
cite its scenario and SHALL be reported as a test with no clause step.

#### Scenario: A vitest test with a nested WHEN

- **GIVEN** a `describe` for the scenario that holds a `describe` titled with the WHEN clause
- **WHEN** that `describe` holds an `it` titled with each THEN clause and each AND after a THEN
- **THEN** lists no missing clause for the scenario

#### Scenario: A flat test titled with the scenario

- **WHEN** a `node --test` file holds a `test` titled with a scenario's capability and name and no clause step
- **THEN** counts the scenario as tested

### Requirement: A step with no clause keyword is not a clause step

A `test.step`, a `describe`, or an `it` whose title starts with no clause keyword, or is not a literal, SHALL NOT be
a clause step. The clause steps nested in it SHALL count as children of its parent, and the matching SHALL ignore it
among clause steps.

#### Scenario: A step that names no clause

- **WHEN** a Playwright test has an extra `test.step` whose title starts with no clause keyword
- **THEN** ignores that step

#### Scenario: A clause step inside a step that names no clause

- **WHEN** a Playwright test nests the leaf of a THEN clause in a `test.step` titled `opens the theme menu`, inside
  the WHEN container
- **THEN** lists no missing clause for the scenario

#### Scenario: Clause steps in a loop over two values

- **WHEN** a Playwright test runs its clause steps in a loop over two values, inside a `test.step` titled with the
  loop variable
- **THEN** lists no missing clause for the scenario

### Requirement: A clause step that matches no clause is reported

A `test.step`, a `describe`, or an `it` whose title starts with a clause keyword and that no clause of the cited
scenario takes SHALL be reported, an enclosing `test.describe` titled with a GIVEN included. In a strict capability
`yarn spec:coverage` SHALL exit with an error on it. A clause step nested in a reported one SHALL NOT be reported a
second time.

#### Scenario: A clause step that matches no clause in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** a test of one of its scenarios holds a `test.step` titled `THEN paints nothing`, which is no clause of the
  scenario
- **THEN** exits with an error, naming the step

#### Scenario: A clause step that matches no clause off the strict list

- **WHEN** a test of a scenario in a capability off the strict list holds a `test.step` titled `THEN paints nothing`,
  which is no clause of the scenario
- **THEN** reports the step and exits without an error

### Requirement: Titles are string literals

Every scenario, step, and clause title SHALL be a string literal or a template literal without a substitution,
because the checker reads source text. A title built from a variable, a concatenation, or a substitution SHALL NOT
count as the scenario or the clause it would name.

#### Scenario: A title built from a variable

- **WHEN** a test's title is a variable that holds a scenario's capability and name
- **THEN** does not count that test for the scenario

#### Scenario: A title in single quotes

- **WHEN** a test is titled `'client-v2-themes: A "Dracula" theme'`, in single quotes
- **THEN** counts that test for the scenario `A "Dracula" theme` of `client-v2-themes`

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
test's title verbatim. The first word after the keyword, with trailing `,.:;` removed, SHALL be lower-case letters
only and end in "s" (shows, saves, sends), and SHALL NOT be one of: its, this, as, always, unless, across,
afterwards, besides, sometimes, towards. A GIVEN, a WHEN, and an AND after either SHALL keep their subject. For a
strict capability, `yarn spec:coverage` SHALL exit with an error on an assertion clause in `openspec/specs/` with any
other first word. The error SHALL read `openspec/specs/` only. The report SHALL print one count per capability of
the assertion clauses that break this rule and do not fail the run: every such clause of a capability off the strict
list, in `openspec/specs/` and in the active changes, and, for a strict capability, the clauses in an active change's
delta.

#### Scenario: A THEN that starts with an article in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios has a THEN clause that starts with "the"
- **THEN** exits with an error, naming the scenario and the clause

#### Scenario: A quoted label or a proper noun first in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios has the clauses `THEN "Save" shows a spinner` and `AND Devnet is checked`
- **THEN** exits with an error, naming the scenario and both clauses

#### Scenario: A deny-list word first in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios has the clause `AND its chip reads Triton` after a THEN
- **THEN** exits with an error, naming the scenario and the clause

#### Scenario: A verb first in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios has the clauses `THEN shows the toast` and `AND saves, then checks its chip`
- **THEN** accepts both clauses

#### Scenario: A THEN that starts with an article off the list

- **WHEN** a scenario of a capability off the strict list has a THEN clause that starts with "the"
- **THEN** counts the clause in the capability's report line and exits without an error

#### Scenario: A subject-first clause in an active change's delta for a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** an active change's delta for it holds a scenario with a THEN clause that starts with "the"
- **THEN** counts the clause in the capability's report line and exits without an error

#### Scenario: A WHEN and its AND with a subject

- **GIVEN** a capability on the strict list
- **WHEN** one of its scenarios has a WHEN clause and an AND after it that both start with "the"
- **THEN** accepts both clauses

### Requirement: An assertion clause holds no user action and no condition

A THEN clause, and an AND after a THEN, SHALL hold no user action and no condition. An action SHALL be a WHEN, so an
action after a THEN SHALL be a later WHEN with assertion clauses of its own. A condition SHALL be a GIVEN or part of
the WHEN. Review SHALL hold this rule: the checker does not read it.

#### Scenario: Review of an action inside an assertion clause (manual)

- **WHEN** a pull request adds a scenario with the clause `AND pressing "Use anyway" saves the RPC and checks its chip`
  after a THEN
- **THEN** gets a review that asks for `WHEN the person presses "Use anyway"` and
  `THEN saves the RPC and checks its chip`

### Requirement: A clause names the values its test uses

In a strict capability a clause SHALL hold no placeholder such as `{name}`, and its example values SHALL be the ones
its test types and asserts, because the step title is the clause verbatim and a literal title cannot substitute a
value. Review SHALL hold this rule: the checker does not read it.

#### Scenario: Review of a placeholder in a clause (manual)

- **GIVEN** a capability on the strict list
- **WHEN** a pull request adds to it a scenario whose AND clause names the toast "Removed" with a placeholder in braces
  in place of the RPC's name, and a test that removes an RPC named "Helius"
- **THEN** gets a review that asks for `AND shows a toast "Removed Helius."`

### Requirement: The coverage report lists tests, levels, missing clauses, and duplicates

`yarn spec:coverage` SHALL report, per scenario with a finding, each test that cites it (file and title), the test's
level, and the clauses each test is missing. In a strict capability it SHALL name every missing clause, a clause
under a missing container excepted. Off the strict list a test with no clause step SHALL take one line, and the
report SHALL name clauses only for a test that has at least one clause step. It SHALL list every scenario that more
than one test cites, as a candidate duplicate, and SHALL NOT fail on one. `yarn spec:coverage --strict` SHALL exit
with an error when any scenario is uncovered, a scenario only an active change adds included.

#### Scenario: Two tests cite one scenario

- **WHEN** a Playwright test and a vitest test are both titled with one scenario's capability and name
- **THEN** lists the scenario among candidate duplicates, naming both tests
- **AND** exits without an error

#### Scenario: A test with no clause step off the strict list

- **WHEN** a Playwright test titled with a scenario of a capability off the strict list holds no clause step
- **THEN** reports that test on one line
- **AND** names no clause of the scenario

#### Scenario: Any uncovered scenario with the strict flag

- **WHEN** `yarn spec:coverage --strict` runs and any capability has an uncovered scenario
- **THEN** exits with an error

### Requirement: Each capability has a generated tests.md

Each capability with a `spec.md` under `openspec/specs/` SHALL have a committed `tests.md` beside it, generated from
`openspec/specs/` only. It SHALL hold one row per clause per test, container clauses included: clause, test file,
test title, and level. A clause the test has no step for, a clause under a missing container included, SHALL have a
row naming that test's file and title, with "missing" in place of the level. A manual scenario SHALL have one row
reading "manual"; an uncovered one, one row reading "none". A manual scenario that a test cites SHALL have that one
row reading "manual" and no row for the test: the conflict is the coverage report's finding. The generator SHALL
delete a `tests.md` whose folder has no `spec.md`.

#### Scenario: A tested scenario's rows

- **WHEN** the generator runs over a scenario with three clauses that one test checks
- **THEN** writes three rows for it to the capability's `tests.md`, each naming the test file, the test title, and the
  level

#### Scenario: A clause without a step in tests.md

- **WHEN** the generator runs over a scenario with three clauses whose one test has a step for two of them
- **THEN** writes three rows for it, the row of the clause without a step reading "missing" in place of the level

#### Scenario: A clause under a missing container in tests.md

- **GIVEN** a scenario whose clauses are `WHEN the page reloads`, a THEN, and an AND
- **WHEN** the generator runs over it and its one test, which holds the leaves of the THEN and the AND in a container
  titled `WHEN the page reloads twice`
- **THEN** writes three rows for the scenario, each reading "missing" in place of the level

#### Scenario: A manual scenario's row

- **WHEN** the generator runs over a scenario marked `(manual)`
- **THEN** writes one row for it to the capability's `tests.md`, reading "manual"

#### Scenario: A manual scenario a test cites in tests.md

- **WHEN** the generator runs over a scenario marked `(manual)` that one test cites
- **THEN** writes one row for it, reading "manual"
- **AND** writes no row that names the test

#### Scenario: An uncovered scenario's row

- **WHEN** the generator runs over a scenario no test cites and whose heading has no `(manual)` mark
- **THEN** writes one row for it to the capability's `tests.md`, reading "none"

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

#### Scenario: A test with no clause step in a strict capability

- **GIVEN** a capability on the strict list
- **WHEN** a test titled with one of its scenarios holds no clause step
- **THEN** exits with an error, naming the scenario's first clause as missing

#### Scenario: A missing clause in a capability off the list

- **WHEN** a test of a scenario in a capability off the strict list has a step for the WHEN clause and none for the
  THEN clause
- **THEN** names the THEN clause as missing and exits without an error

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
the change is archived: neither a missing clause nor a clause step that matches no clause of the `openspec/specs/`
copy SHALL fail the run for it. A scenario of `openspec/specs/` whose requirement an active change removes SHALL be
reported and SHALL NOT fail the run until the change is archived. These exemptions SHALL apply to the strict list
only: `yarn spec:coverage --strict` SHALL exit with an error on any uncovered scenario, one an active change adds or
removes included.

#### Scenario: A proposal adds a scenario to a strict capability

- **WHEN** an active change's delta adds a scenario to a strict capability and no test cites it
- **THEN** reports the scenario as uncovered and exits without an error

#### Scenario: A proposal adds a scenario, with the strict flag

- **WHEN** `yarn spec:coverage --strict` runs and an active change's delta adds a scenario no test cites
- **THEN** exits with an error, naming the scenario

#### Scenario: A proposal removes a scenario of a strict capability

- **GIVEN** an active change whose delta removes a requirement of a strict capability
- **WHEN** a task of that change deletes the test of one of the requirement's scenarios while the change stays open
- **THEN** reports the scenario as uncovered and exits without an error

#### Scenario: A proposal removes a scenario whose test is gone, with the strict flag

- **GIVEN** an active change whose delta removes a requirement, and no test that cites one of the requirement's
  scenarios
- **WHEN** `yarn spec:coverage --strict` runs
- **THEN** exits with an error, naming the scenario

#### Scenario: A proposal rewords a scenario of a strict capability

- **GIVEN** an active change that modifies a strict capability's requirement and rewords a clause of its scenario
- **WHEN** the scenario's test retitles its step to the reworded clause
- **THEN** checks the scenario by its name only and exits without an error
