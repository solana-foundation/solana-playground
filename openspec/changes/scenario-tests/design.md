# Design

## Context

See [proposal.md](proposal.md), "Why". The facts in this section were read at `8c8d5460b`.

- `client-v2/scripts/spec-coverage.mjs` reads scenarios from `openspec/specs/` and from active changes, reads test
  titles from `e2e/` with a regular expression (`TEST_TITLE`, the first double-quoted argument of `test(` or
  `test.only(`), and reports. `--strict` exits with an error on any uncovered scenario; the `checks` job of
  `.github/workflows/reusable-client-v2.yml` runs it without `--strict`.
- The `checks` job checks out with `fetch-depth: 0`, so a pull request's base branch is available to `git show`.
- Only `e2e/client-v2-layout.e2e.spec.ts` uses `test.step`. Its one step is titled with a variable, and no test
  title in `e2e/`, `src/`, `api/`, or `scripts/` starts with a clause keyword.
- `openspec validate --all --strict` (pinned CLI 1.14.0) passes with a `tests.md` beside a `spec.md` under
  `openspec/specs/`, and ignores a `#### Scenario:` heading inside it. `/opsx:archive` writes only `spec.md`;
  retiring a capability deletes only `spec.md`.
- `jest/valid-title` warns on "unit", "integration", and "e2e" in a `describe` title in `src/**/*.{test,spec}.*`
  (`"warn"` in `client-v2/eslint.config.mjs`; `client-v2/CLAUDE.md`, "What review keeps finding"). A warning does not
  change the exit code of `yarn lint` until the total passes `--max-warnings`. The same section's item "A test title
  says what the code does" accepts a title that starts with "should" or a verb, or the scenario format, so it sets no
  rule for the first word of a clause.
- `api/ai.test.mjs`, `src/app/ShareGistDialog/ShareGistDialog.test.tsx`, and `scripts/server-url-gate.test.mjs`
  already title a flat `it` or `test` with `<capability>: <scenario>`, with no clause `describe`. The last cites "A
  preview build without the variable" and "A CI build", which `client-v2-build-server-endpoint` marks `(manual)`.
- `vitest.config.ts` names the files vitest collects in `include`, and `client-v2/AGENTS.md` requires
  `<name>.test.mts` for a module the Playwright suite imports, which `include` collects. The config also sets
  `mockReset: true`, which clears every mock's recorded calls before each test.
- Some tests skip themselves under a condition known only at run time.
  `client-v2-layout: The editor's keyboard button on an iPhone` in `e2e/client-v2-layout.e2e.spec.ts` calls
  `test.fixme(browserName === "firefox", …)`; the `ui-migration` change's delta of `client-v2-layout` holds its
  scenario. The database cases of `node --test` files such as `api/projects.test.mjs` hold
  `{ skip: !DB && "DATABASE_URL not set" }`. `e2e/two-tabs.e2e.spec.ts` and `e2e/account-sync.e2e.spec.ts` each call
  `test.fixme(!!process.env.CI, …)` in one test, and neither test cites a scenario.
- A unit test that calls `vi.mock` or renders React keeps a `*.test.ts` file (`client-v2/AGENTS.md`, "Tests: a
  module's unit tests live in the module"; `openspec/specs/client-v2-unit-tests/spec.md`), so a file under `src/` is
  not always an integration test by its kind.
- Most THEN clauses in `openspec/specs/` start with a subject. The most common first word is "the", then a backtick,
  then "it", "no", "a", and "its".

A spike applied this design to `client-v2-custom-rpcs`: the checker with the matching of decision 5 and the verb
rule of decision 12, the rewritten spec, and the converted tests. The spike is uncommitted work on top of `8c8d5460b`
in a local worktree, so this document cites its numbers and no link. The numbers that describe the spike's own files
and runs cannot be re-derived from the repository: the counts of the converted test file, the 4 assertions the
conversion added (decision 12), the two line counts of the report (decision 6), the "20 passed" of the test run, the
two failure names (decision 2), and the three mutations that failed `yarn spec:coverage`.

- The conversion of `client-v2/e2e/client-v2-custom-rpcs.e2e.spec.ts` covered 20 tests, with 60 clause steps and 2
  steps with no clause keyword, and the file grew from 465 to 615 lines.
- With the capability on the strict list, `yarn spec:coverage` passed, and
  `yarn test-e2e e2e/client-v2-custom-rpcs.e2e.spec.ts` gave 20 passed. A renamed leaf, a THEN moved beside its WHEN,
  and a renamed WHEN each made `yarn spec:coverage` exit with an error.
- The longest `test.step` line of the converted file is 149 columns, and 6 exceed 120. Prettier keeps a title on one
  line, and `client-v2/eslint.config.mjs` holds no `max-len` rule.
- The spike's checker read `e2e/` only. The `describe` and `it` shape of decision 1 has not run under a checker.

## Goals / Non-Goals

**Goals:**

- One parser of test sources, shared by the coverage report, the `tests.md` generator, and the strict gate, so the
  three never disagree on which test checks which clause.
- One rule that matches a clause to its step in Playwright, vitest, and `node --test` (decision 5).
- A test file's shape that a reader of the spec and a reader of the test failure both recognise: the failure's full
  name reads as the scenario's clauses. Decision 2 records the name Playwright printed for a nested step.

**Non-Goals:**

- Running the tests. The checker reads source text; whether a step passes is the test runner's job.
- Checking that a scenario's body follows the clause format, beyond the first word of an assertion clause
  (decision 12). `openspec/config.yaml` asks for it when a spec is written, and review checks it; a scenario with no
  clause keyword has no clause to miss. Review also holds the two rules the checker cannot read: no action or
  condition in an assertion clause (decision 13), and the values a clause names (decision 14).
- Rewriting the assertion clauses of every existing spec. A capability is rewritten when it joins the strict list.
- Splitting a compound THEN when a capability joins the strict list. At `8c8d5460b`, 916 of the 966 scenarios in
  `openspec/specs/` hold exactly two clauses, so one THEN often holds several assertions, and splitting them all is
  outside this change.

## Decisions

### 1. Vitest and node tests: GIVEN and WHEN as nested `describe`s

A scenario's test is `describe("<capability>: <scenario>")`. Each container clause (a GIVEN, a WHEN, and an AND
after either) is a `describe` titled with the clause, nested in the `describe` of the container clause before it. Each
assertion clause (a THEN, and an AND after a THEN) is an `it` titled with the clause, in the `describe` of its WHEN,
or of the AND after that WHEN. An AND after a GIVEN or a WHEN is a `describe` because it extends a precondition or an
action and so holds no assertion. Decision 5 states this nesting as one rule for both runners.

Why: a hook has no title, so a GIVEN or WHEN run in a bare `beforeEach` leaves the checker nothing to read. A
nested `describe` carries the title, holds the hook that runs the step, and makes vitest's failure name read
`<capability>: <scenario> > WHEN ... > THEN ...`.

Alternative: one `it` per scenario with the clauses as comments. Rejected: a comment is not part of the failure name,
and the checker reads titles, never comments, so the clauses would have nothing it can match.

A precondition or an action runs in a hook of its `describe` when it has something to run. A GIVEN whose
precondition is a constant fixture has no hook. Where the step runs is the test author's choice:

| Hook         | Cost                                                                                  | Use when                                                         |
| ------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `beforeEach` | The action runs once per `it`: a slow action multiplies, a side effect repeats        | The action is fast and each `it` needs a fresh result            |
| `beforeAll`  | The `it`s share one result: an `it` that changes it breaks the next; a failed action fails every `it` | The action is slow (a render and a wait, a build) and every `it` only reads |

A THEN that asserts on a mock needs `beforeEach`, or a `beforeAll` that copies the spy's calls into a local
variable before the tests run: `mockReset: true` in `client-v2/vitest.config.ts` clears the calls a `beforeAll`
recorded before the first `it` reads them, so "calls X" fails and "sends no request" passes whatever the action did.

The same shape applies to `node --test` files, whose `describe`, `it`, `before`, and `beforeEach` come from
`node:test`.

A flat `it` or `test` titled `<capability>: <scenario>`, with no clause `describe`, cites its scenario but holds no
clause step. Off the strict list the report gives such a test one line (decision 6), and a listed capability fails on
it (decision 8). Counting such a test as covered with nothing reported would hide the drift this change exists to
report, and not counting it would show a scenario with a passing test as uncovered. Context names the files that hold
such tests.

### 2. Playwright: nested `test.step`s; a GIVEN may be an enclosing `test.describe`

A scenario's test is `test("<capability>: <scenario>")`, and its clause steps nest as decision 5 states. A GIVEN, a
WHEN, and an AND after either is a `test.step` that holds the step of every clause after it. A THEN, and an AND after
a THEN, is a `test.step` inside the step of its WHEN. A GIVEN is either such a `test.step` in the body or a
`test.describe("GIVEN ...")` around the test whose `beforeEach` or `beforeAll` runs the precondition; a
`test.describe.serial("GIVEN ...")` counts as the same form. Both forms count.

Why nested steps: Playwright adds the enclosing steps to a failure's name, so the name reads as the scenario's
clauses, as vitest's does (decision 1). In Playwright 1.65.0, the version `client-v2/yarn.lock` locks for
`@playwright/test`, `formatTestHeader` adds them only when every failed attempt of the test fails along one step
path. CI retries a failed test once (`retries` in `client-v2/playwright.config.mts`), so a test whose retry fails in
another step gets a name without steps. For a failed assertion in a nested step the spike's run, with no retry,
printed:

```text
client-v2-custom-rpcs: A local validator over plain HTTP is accepted › WHEN a person saves `http://localhost:8899` › THEN saves and picks it
```

One rule then matches both runners (decision 5). Nesting also gives a place to a THEN that is observed while its
action still runs: the THEN is a leaf inside the WHEN step, and the rest of the action follows the leaf. "A URL that
answers is saved" asserts the spinner in "Save" while the health request is held, then lets the request answer.

Alternative: one `test.step` per clause, all in the test body, matched by source order alone. Rejected for three
reasons. The failure name held only the scenario and the THEN: the spike's run with such steps printed
`client-v2-custom-rpcs: A local validator over plain HTTP is accepted › THEN saves and picks it`. The checker needed
a second matching rule for Playwright. A THEN observed while its action still runs had no place between two steps.

Why the enclosing `test.describe`: where a precondition runs is the test author's choice, as in decision 1. A
precondition shared by several scenarios (a seeded project, a signed-in session) belongs in a hook, and a
`test.step` inside a hook is not inside the test's body, so the enclosing `test.describe` carries the title instead.

### 3. Sources are parsed with the TypeScript compiler API

The checker parses each source file with `ts.createSourceFile` (`typescript` is a dependency of `client-v2`) and
walks the calls of `test`, `test.describe`, `test.step`, `describe`, and `it`, keeping their nesting. A member call
other than a skip form (`skip`, `fixme`, `todo`, `skipIf`, `runIf`, and `test.step.skip`) reads as its base call:
`test.only`, `describe.only`, `it.only`, `describe.concurrent`, and `it.fails` are examples, and
`test.describe.serial` reads as `test.describe`. A list of the members would lack the next one a runner adds, and the
checker would then not count a test written with it. vitest's `skipIf` and `runIf` are curried: in
`describe.skipIf(condition)("title", fn)` the callee is itself a call. A call whose callee is a call of `skipIf` or
`runIf` reads as the base call of that member, `describe` in the example, and counts as conditionally skipped. The
checker imports `typescript`, so `yarn spec:coverage` runs only where the dependencies of `client-v2` are installed,
which holds in the `checks` job.

Why: the regular expression `TEST_TITLE` reads one title per call and loses which `it` sits in which `describe`,
which decision 1 depends on. It also reads only double-quoted titles, while Prettier writes a title that contains a
double quote in single quotes.

Alternative: run each suite with a listing reporter (`vitest list`, `playwright test --list`). Rejected: Playwright's
list mode does not report `test.step` titles, the listing needs the real wasm packages and a configured environment,
and the freshness check (decision 7) must run in the `checks` job without a build.

A title counts when it is a string literal or a template literal without a substitution. An unconditional skip
does not count:

- `.skip`, `.fixme`, and `.todo` on `test`, `it`, and `describe`, `test.describe.skip` and `test.describe.fixme`
  included;
- a test whose body holds, as a statement of the body itself, `test.skip()` or `test.fixme()` with no argument, or
  `test.skip(true, …)` or `test.fixme(true, …)` with the literal `true`;
- a `node:test` call whose options hold `skip` or `todo` as the literal `true` or a string.

A `test.step.skip` is not a step of its clause, so that clause is missing for the test.

A conditional skip counts as covering the scenario: an in-body `test.skip(<condition>, …)` or
`test.fixme(<condition>, …)` with any other condition, a `test.skip` or `test.fixme` call with no argument or with
the literal `true` anywhere else in the body, such as inside an `if`, a `node:test` `skip` or `todo` option holding
any other expression, and vitest's `skipIf` and `runIf`.

Why: the checker reads source text and cannot evaluate a condition such as `browserName === "firefox"` or `!DB`. A
conditionally skipped test runs in some environment, and counting it as skipped would report
`client-v2-layout: The editor's keyboard button on an iPhone` as uncovered, though CI runs it on Chromium (Context).
A zero-argument call or a call with the literal `true`, as a statement of the test body, needs no evaluation, like
`node:test`'s `skip: true`, so it is unconditional. The same call inside an `if` runs only when the `if`'s condition
holds, which the checker cannot evaluate, so it is conditional. The cost, a test whose condition holds in CI, is in
Risks.

### 4. Sources and levels follow the file's path

| Source                                                                | Level       |
| --------------------------------------------------------------------- | ----------- |
| `client-v2/e2e/**/*.ts`                                               | end-to-end  |
| the files the `include` globs of `client-v2/vitest.config.ts` collect | integration |
| the `*.test.mjs` files the `test-api` script of `package.json` runs   | integration |

The checker reads `include` from `vitest.config.ts` instead of keeping a list of its own, so a test file vitest runs,
such as a `<name>.test.mts` that `client-v2/AGENTS.md` requires, is never invisible to the checker.

A test's level comes from its file's path, not from the kind of test. A single-module test that calls `vi.mock` or
renders React keeps a `*.test.ts` file under `client-v2-unit-tests` and cites no scenario; if it cites one, the
checker reports it at the integration level, and review judges whether the level fits the scenario.

In-source blocks are never read: `includeSource` is not a source, so a scenario title in a unit block leaves the
scenario uncovered.

Why a `node --test` row: the checker and the generator of this change are `.mjs` scripts tested with `node --test`
under `client-v2/scripts/`, so without that row this capability's own scenarios could never be covered, and neither
could the scenarios of `api/` modules.

### 5. A clause matches a step by normalised text and by nesting

The scenario's clauses are read as the list items that start with a bold keyword, with indented continuation lines
joined. Each clause and each step title is normalised by collapsing every run of whitespace to one space and removing
the `**` around the keyword; backticks and every other character stay.

One rule matches both runners. A container clause is a GIVEN, a WHEN, or an AND after either, and its step is a
container: a `test.step` in Playwright, a `describe` in vitest and `node --test`. An assertion clause is a THEN or an
AND after a THEN, and its step is a leaf: a `test.step` in Playwright, an `it` in vitest and `node --test`. A
container holds the step of every clause after it in the scenario. The checker reads the scenario's clauses in order
and keeps a current container, which at the start is the test body in Playwright and the scenario's `describe` in
vitest and `node --test`:

- the step of a container clause must be a child of the current container, and it becomes the current container;
- the step of an assertion clause must be a child of the current container;
- inside one container, each clause takes the first child with its text after the child the clause before it took
  there.

So a leaf is a child of the container of the WHEN before it, or of the AND after that WHEN. A clause with no such
child is missing. When a container clause is missing, the clauses under it are not compared, and the report names the
container clause alone. In Playwright a GIVEN that an enclosing `test.describe` carries (decision 2) is matched
there, and the current container stays the test body.

Why: the nesting check catches a THEN whose action never ran for it. An `it` outside the WHEN `describe` runs without
the WHEN's hook, and a `test.step` beside its WHEN step loses the WHEN from the failure name. The order inside one
container catches a leaf written before the leaf of an earlier clause, which a set comparison would accept. Keeping
backticks avoids a second rule for what counts as formatting.

Why one line for a missing container: one renamed WHEN left every clause under it without a step, and the spike,
which printed each of them, gave up to 6 lines for one renamed step. The lines after the first say nothing that the
first does not.

A scenario may hold a later WHEN after a THEN, with assertion clauses of its own. By the rule its container is a
child of the current container, so it is nested in the WHEN before it, after that WHEN's leaves.

Why: the failure name then says that the later THEN ran after both actions. In Playwright the later WHEN sees the
locals of the WHEN before it. In the `describe` shape the `beforeEach` of the WHEN before it still runs for the
later WHEN's `it`s.

Alternative: the container of the later WHEN beside the container of the WHEN before it. Rejected for the same three
reasons: the failure name would hold the later action alone, a `const` declared in the first step would be out of
scope in the second, and a sibling `describe` runs without the first WHEN's hook.

A `test.step`, a `describe`, or an `it` whose title starts with no clause keyword, or is not a literal, is not a
clause step. The clause steps nested in it count as children of its parent, and the matching ignores it among clause
steps. So a test keeps its helper steps, and an assertion beyond the clauses stays in a step of its own. The spike
needed this for a test that runs one scenario over two values in a loop, with a step titled with each value around
the clause steps.

The checker reads only the test's own body, and in vitest and `node --test` the scenario's `describe`. The one
clause it reads outside them is a GIVEN that a `test.describe` around a Playwright test carries (decision 2). It does
not follow calls, so a clause step written inside a helper function that the test calls is not seen. Every other
clause step is written in the test.

A `test.step`, a `describe`, or an `it` whose title starts with a clause keyword and that no clause of the cited
scenario took is reported, an enclosing `test.describe` titled with a GIVEN included. In a strict capability
`yarn spec:coverage` exits with an error on it. A clause step nested in a reported one is not reported a second
time.

Why: this catches a step left behind after its clause is removed or reworded. A check of missing clauses alone
passes a test that still runs the step of a removed clause.

### 6. Report shape

`yarn spec:coverage` prints, per scenario with a finding, the tests that cite it (file, title, level) and each test's
findings: its missing clauses and its clause steps that match no clause (decision 5). It then prints one count per
capability of the assertion clauses that break the verb rule and do not fail the run (decision 12): every such clause
of a capability off the strict list, in `openspec/specs/` and in active changes, and, for a strict capability, the
clauses in an active change's delta. Then it prints the candidate duplicates (a scenario more than one test cites, at
any level), and then the totals line, extended with the integration and end-to-end counts. Duplicates never change
the exit code.

Off the strict list the report is compact: a test with no clause step takes one line, and clauses are named only for
a test that has at least one clause step. In a strict capability every missing clause is named, under decision 5's
rule for a missing container.

Why: at `8c8d5460b` no test holds a clause step (Context), so off the strict list every test that cites a scenario
misses every clause. With every clause named the spike's report was 2,661 lines. In the compact form it is 838, of
which 513 are the one-line findings. A capability's clauses are worth naming once one of its tests holds a clause
step, which is when its conversion has started.

A scenario marked `(manual)` that a test cites is reported as a conflict, and fails in a strict capability: the mark
says the scenario needs no test, the test says it has one, and only the author knows which is right.

### 7. `tests.md`: one per capability, generated, checked in the `checks` job

`yarn spec:tests` writes `openspec/specs/<capability>/tests.md` for every capability with a `spec.md`, including
capabilities whose scenarios are all manual, and deletes a `tests.md` beside no `spec.md`. `yarn spec:tests --check`
writes nothing and exits with an error naming each file that would change, and the command to run.

Format:

```markdown
# <capability> tests

Generated by `yarn spec:tests` from [spec.md](spec.md) and the tests that cite it. Do not edit.

## <scenario name>

| Clause | Test file | Test title | Level |
|---|---|---|---|
| WHEN ... | `client-v2/e2e/<file>.ts` | <capability>: <scenario name> | end-to-end |
```

The generator writes one row per clause per test, container clauses included. A clause the test has no step for gets
a row with that test's file and title and a Level reading `missing`. A clause under a missing container gets such a
row too, though the coverage report names the container clause alone (decision 5), so the file lists every clause of
the scenario. A manual scenario has one row whose Level reads `manual` and whose other cells are empty; an uncovered
one, one row whose Level reads `none`. A manual scenario that a test cites keeps that one row and gets no row for the
test: the conflict is the coverage report's finding (decision 6). A `|` in a cell is escaped. Scenarios are `##`
headings, never `#### Scenario:`, so no reader of spec headings mistakes the file for a spec. File paths are relative
to the repository root.

Why every capability, not only strict ones: the file answers "which tests check this capability" for any reader, and
generating it for some capabilities would add a second list to keep. Why the `checks` job: the check reads only
source text, so it needs no build, unlike `scripts/bundle-info.build-test.mjs`.

### 8. The strict list is a plain text file beside the checker

`client-v2/scripts/spec-coverage-strict.txt` names one capability per line; `#` starts a comment, as in
`client-v2/e2e/known-skips.txt`. `yarn spec:coverage` enforces it on every run, with no flag, so a local run fails
where CI fails. `--strict` keeps its meaning: any uncovered scenario in any capability fails.

Why outside `openspec/`: the OpenSpec CLI and `/opsx:archive` never read or write the file, and the list governs
the checker, not a spec.

### 9. The base-branch comparison reads the list with `git show`

`yarn spec:coverage --base <ref>` reads `<ref>:client-v2/scripts/spec-coverage-strict.txt` with `git show`. A
missing file on the base is an empty list, so the PR that adds the file passes. CI passes
`--base origin/${{ github.base_ref }}` on `pull_request` runs and nothing on `push` runs. A capability may leave the
list in the PR that deletes its `spec.md`, because a retired capability has no scenarios to gate and a listed name
with no spec fails the run.

### 10. Active changes: added scenarios are reported, modified ones are matched by name, removed ones are not gated

The gate reads `openspec/specs/` only. A scenario that exists only in an active change's delta is reported. A
scenario of a requirement listed under `## MODIFIED Requirements` in any active change's delta for that capability is
gated by its name only: its test must exist, its clauses are not compared, and a clause step that matches no clause
of the `openspec/specs/` copy is not an error. A scenario of `openspec/specs/` that an
active change's delta removes, under `## REMOVED Requirements`, is reported and not gated, so the task that removes
the behaviour can remove its test while other tasks keep the change open. When the change is archived, the
clauses of `openspec/specs/` are compared again, and archiving needs every task ticked, so the test is updated by
then.

These exemptions belong to the strict list only. `--strict` keeps the meaning decision 8 gives it, so it fails on an
uncovered scenario that only an active change adds, as on any other, and on a scenario a delta removes whose test is
already gone. `--strict` is a whole-tree check for a developer who asks for it; CI does not pass it.

### 11. Order of pull requests

The proposal lands as a docs-only PR (`client-v2/CLAUDE.md`, "Specs and changes", step 3) holding only this change's
folder. Task 1.1 then moves the rule out of `client-v2/CLAUDE.md` and adds the `config.yaml` line. Until the change is
archived the capability exists only as this change's delta, so the pointer names
`openspec/changes/scenario-tests/specs/scenario-tests/spec.md`, and the archive PR re-points it at
`openspec/specs/scenario-tests/spec.md` (task 6.1). The checker, the generator, the gate, and the pilots
follow in PRs of their own, in the order [tasks.md](tasks.md) gives.

### 12. An assertion clause starts with a verb; the checker holds a positive rule on its first word

Every THEN, and every AND after a THEN, starts with a verb after its keyword: "THEN shows the error toast", "THEN
sends no request". GIVEN, WHEN, and an AND after either keep their subject: "WHEN the user deploys". The keyword an
AND follows is the one decision 1 nests it under.

Why: the clause is the test's step title verbatim, and an assertion's subject is the system under test, which the
scenario's title and its WHEN already name, so a subject-first THEN repeats it in every failure name. No rule in
`client-v2/CLAUDE.md` sets it: "A test title says what the code does" accepts "should" or a verb, and the scenario
format, and sets nothing for a clause's first word (Context).

The checker holds the rule that the spec requirement "An assertion clause starts with a verb" states. The first word
after the keyword, with trailing `,.:;` removed, is lower-case letters only and ends in "s" ("shows", "saves",
"sends"), and is not on the requirement's deny list. For a strict capability the checker exits with an error on any
other first word of a clause in `openspec/specs/`. The error reads `openspec/specs/` only, as the gate does (decision
10). The report prints one count per capability of the clauses that break the rule and do not fail the run (decision
6): every such clause of a capability off the strict list, and a strict capability's clauses in an active change's
delta. Review catches a first word that passes the rule and is not a verb.

Why a positive rule: a verb cannot be detected without a language parser, and a parser would add a dependency and
still misread words that are both a noun and a verb ("reports", "lists"). An assertion clause states what the system
does in the third person, and that form of an English verb ends in "s". A quoted label, a proper noun, a number, and
a word in another form all fail the rule without being listed. At `8c8d5460b` the rule rejects 975 of the 977
assertion clauses in `openspec/specs/` outside `client-v2-custom-rpcs`. Of the two it passes, one is verb-first
(`AND reads "Build the program first."` in `client-v2-stages`) and one starts with a plural noun ("requests to the
server carry …" in `assistant-tool-config`), which review catches.

Alternative: a closed list of first words that are not verbs (the, a, an, it, its, no, nothing, that, each, every,
both, neither, one, and a leading backtick). Rejected: over the same 977 clauses it rejected 879. The 98 it passed
started with a quoted label (30), a capitalised word such as a proper noun (38), a number (2), a lower-case word the
list does not name, such as "step", "reading", "only", and "once" (27), or bold emphasis (1:
`THEN **Delete my key** is shown disabled` in `assistant-own-key`). A list of subjects grows with every subject a
spec author picks.

The deny list holds words that pass the form and are not verbs. Only `its` comes from the specs: at `8c8d5460b` it
starts 26 of the 977 clauses, and 53 assertion clauses across `openspec/specs/` and the active changes outside
`client-v2-custom-rpcs`, each scenario counted once. The other words on the list are function words that end in
"s", listed without an occurrence.

Scope: a scenario written after task 1.1 follows the rule through the `rules.specs` line of `openspec/config.yaml`.
An existing capability is rewritten when it joins the strict list (tasks 5.1 and 5.3 for the pilots), and its tests'
step titles follow the rewritten clauses. Other existing specs keep their wording; the checker reports their count
only.

The pilots edit `openspec/specs/client-v2-custom-rpcs/spec.md` and
`openspec/specs/client-v2-build-server-endpoint/spec.md` directly, with no change of behaviour. Beyond the first word
of an assertion clause and the `(manual)` marks, a pilot may move a condition into a GIVEN, split a clause into a
later WHEN and its THEN (decision 13), and replace a placeholder or an example value (decision 14). The conversion of
the tests adds an assertion for a clause part that had none (the spike added 4), and keeps an assertion beyond the
clauses in a step titled with no clause keyword (decision 5). A pilot may also add a scenario for a case that a
narrowed scenario leaves out. It writes that scenario directly in the capability's `spec.md` under `openspec/specs/`,
like its other edits, and gives it a test in the same pull request or the `(manual)` mark, so the capability does not
join the strict list with an uncovered scenario (task 5.2 for `client-v2-custom-rpcs`). A `## MODIFIED Requirements`
delta would put every rewritten scenario under decision 10's name-only exemption until archive, so the pilots would
not prove the clause-by-clause gate they exist to prove.

Task 5.1 settles two details the spike left open. "Editing renames the chip" covers only a picked RPC once its
condition is a GIVEN, so the task decides whether an RPC that is not picked gets a scenario of its own. The THEN
after "Use anyway" in "Offline, nothing is sent" reads "saves the RPC" in the spike, while its test asserts that the
chip is checked, so the task rewords the clause to name what the test asserts.

There are two pilots, and no active change edits either, so the gate is proven without touching other changes.
`client-v2-custom-rpcs` (task 5.1) proves the nested Playwright steps of decision 2;
`client-v2-build-server-endpoint` (task 5.3) proves a THEN `it` nested in its WHEN `describe` (decision 1), in vitest
and in `node --test`. The checker matches both by the one rule of decision 5, over the one source tree of decision 3.
The second pilot's scenarios have no GIVEN and no AND, so the checker's own tests (task 2.2) cover those `describe`s.
The second pilot also exercises a scenario moving from `(manual)` to tested, a flat test converted to the clause
form, and the rule that an in-source unit block cites no scenario.

### 13. An assertion clause holds no user action and no condition; review holds the rule

An action is a WHEN, so an action after a THEN is a later WHEN with assertion clauses of its own (decision 5). A
condition is a GIVEN, or part of the WHEN: "WHEN the browser is offline and a person saves a valid custom URL" stays
valid.

Why: a leaf holds assertions only, so an action or a condition inside an assertion clause has no step of its own, and
the failure name does not say which action ran before the failed assertion. In the spike five clauses of
`openspec/specs/client-v2-custom-rpcs/spec.md` at `8c8d5460b` broke the rule. One of them,
`AND pressing "Use anyway" saves the RPC and checks its chip`, became `WHEN the person presses "Use anyway"` and
`THEN saves the RPC and checks its chip`. The later WHEN is not a form the spike introduced: at `8c8d5460b` nine
scenarios hold two WHENs, one in `openspec/specs/` and eight in active changes.

Why review and not the checker: telling an action or a condition from an assertion needs the meaning of the clause,
which the checker does not read. The spec gives the rule a `(manual)` scenario, as it does for the level a test is
written at.

### 14. A clause names the values its test uses; review holds the rule

In a strict capability a clause holds no placeholder such as `{name}`, and its example values are the ones the test
types and asserts.

Why: the step title is the clause verbatim, and a literal title cannot substitute a value. A title with another
value than the test's describes a run that did not happen. At `8c8d5460b` six clauses of
`openspec/specs/client-v2-custom-rpcs/spec.md` held a placeholder or named a value their test did not use. Where a
value is incidental to the requirement, the spec's example moves to the test's value: "A URL that answers is saved"
named `https://api.devnet.solana.com` while its test types `https://slow.rpc.test/`, and the clause took the test's
address. A placeholder takes the test's value the same way: `"Already saved as {that RPC's name}."` became
`"Already saved as Helius."`. Where the requirement depends on the value, the test's fixture moves to the spec's
value.

One clause moved together with its test. "A value that is not an https URL is refused" named
`http://api.devnet.solana.com`, and its test typed the same address (`Endpoint.DEVNET.replace("https:", "http:")`).
The spike moved both to `http://rpc.example.com`, because the step title would hold a cluster address: the case of
the `CLUSTER_URL_SELECTORS` entry in Risks.

Why review and not the checker: the checker compares titles, not the values a test types. The spec gives the rule a
`(manual)` scenario.

## Risks / Trade-offs

- [Almost every existing assertion clause breaks the verb rule, 975 of 977 in `openspec/specs/` outside
  `client-v2-custom-rpcs` at `8c8d5460b`, so reporting each one off the strict list buries the other findings] → Off
  the strict list the report prints one count of such clauses per capability; a strict capability's clauses are named
  one by one.
- [A capability that joins the strict list while an active change edits it gets subject-first clauses back when
  that change is archived] → The gate reads `openspec/specs/` only, so that archive PR fails until it rewrites those
  clauses; the failure names each clause.
- [A GIVEN, WHEN, or AND clause containing "unit", "integration", or "e2e", or a scenario `describe` such as
  `client-v2-unit-tests: <scenario>`, becomes a `describe` title that `jest/valid-title` warns on, and the warning
  raises the total `--max-warnings` caps] → Task 2.3 narrows the rule's `mustNotMatch.describe` pattern to `describe`
  titles that start with neither a clause keyword nor `<capability>: `.
- [A step title is a string literal, and `no-restricted-syntax` (`CLUSTER_URL_SELECTORS` in
  `client-v2/eslint.config.mjs`) is an error on a literal that holds a cluster address such as
  `api.devnet.solana.com`, so a clause that names one cannot be a step title as written] → A capability whose clause
  names a cluster address moves the example to a test host when it joins the strict list, or its step title takes an
  `eslint-disable-next-line` with a reason. Decision 14 resolved it in `client-v2-custom-rpcs`: its examples moved to
  `rpc.example.com` and `*.rpc.test`, and no title needs a disable. At `8c8d5460b`, 11 clauses in 4 specs under
  `openspec/specs/` name a cluster address. 8 of them sit in `(manual)` scenarios, which have no step.
- [A strict capability's test quarantined with an unconditional `.fixme` or `test.fixme()` is uncovered, so every
  PR fails until it is fixed] → Intended: the gate makes the quarantine visible. The PR that quarantines it either
  fixes the test or marks the scenario `(manual)` in the spec, and review sees both. The checker does not read
  `e2e/known-skips.txt`; a quarantine reaches the gate only through a skip in the source.
- [A test whose skip condition holds in CI counts as covered, though CI never runs it] → Accepted, because the
  checker cannot evaluate a condition (decision 3). At `8c8d5460b` no test that cites a scenario is in that state:
  the two `test.fixme(!!process.env.CI, …)` calls, in `e2e/two-tabs.e2e.spec.ts` and
  `e2e/account-sync.e2e.spec.ts`, sit in tests that cite no scenario (Context). The other conditional skips are
  counted as intended: a test with `test.fixme(browserName === "firefox", …)`, such as
  `client-v2-layout: The editor's keyboard button on an iPhone`, runs on Chromium in CI, and the database cases of
  `node --test` files (`{ skip: !DB && "DATABASE_URL not set" }`) skip only on a machine without `DATABASE_URL`,
  which the `checks` job sets, so they run there.
- [Two parallel PRs that retitle tests of one capability both change its `tests.md` and conflict] → The file is
  generated: the second PR rebases and runs `yarn spec:tests`.
- [A scenario's clause wording is copied into a test title, so a long clause makes a long test name and a long
  source line: the spike's longest `test.step` line is 149 columns (Context)] → Accepted: the failure name then reads
  as the spec, Prettier keeps the title on one line, and no lint rule limits the line.
- [A test title built in a loop (`it.each`, `it(label, ...)`) cannot cite a scenario] → Such a test checks one
  module's table of cases, which is the unit level; a scenario needs literal titles. A test that runs one scenario
  over several values keeps literal clause steps inside a step titled with each value (decision 5).
- [Reverting the strict list in an emergency fails the base comparison] → Removing a capability needs a PR that a
  maintainer merges past the failed check; the check names the capability, so the reason is on record.
