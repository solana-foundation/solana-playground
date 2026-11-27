# Design

## Context

See [proposal.md](proposal.md), "Why". The facts below were read at `de036c4a6`, and checked again at the head of the
pull request that adds this change.

- `.claude/skills/quality-spec-coverage/scripts/spec-coverage.mjs` (task 4.1 moved it from `client-v2/scripts/`)
  reads scenarios from `openspec/specs/` and from active changes, reads literal double-quoted test titles with a
  regular expression, and gates them on the exclude list (decision 8). `--strict` exits with an error on any
  uncovered scenario; the `checks` job of `.github/workflows/reusable-client-v2.yml` runs it without `--strict`.
- The `checks` job checks out with `fetch-depth: 0`, so a pull request's base branch is available to `git show`.
- Only `e2e/client-v2-layout.e2e.spec.ts` uses `test.step`.
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
- `vitest.config.ts` collects `src/**/*.{spec,test}.{js,jsx,ts,tsx,mts}` and `src/**/__tests__/**` (`include`), and
  `client-v2/AGENTS.md` requires `<name>.test.mts` for a module the Playwright suite imports. It also sets
  `mockReset: true`, which clears every mock's recorded calls before each test.
- Some tests skip themselves under a condition known only at run time: `e2e/assistant-code-stream.e2e.spec.ts`
  (`test.fixme(browserName === "firefox", …)`), `e2e/two-tabs.e2e.spec.ts` (`test.fixme(!!process.env.CI, …)`), and
  the database cases of `node --test` files such as `api/projects.test.mjs` (`{ skip: !DB && "DATABASE_URL not set" }`).
- A unit test that calls `vi.mock` or renders React keeps a `*.test.ts` file (`client-v2/AGENTS.md`, "Tests: a
  module's unit tests live in the module"; `openspec/specs/client-v2-unit-tests/spec.md`), so a file under `src/` is
  not always an integration test by its kind.
- Most THEN clauses in `openspec/specs/` start with a subject. The most common first word is "the", then a backtick,
  then "it", "no", "a", and "its".

## Goals / Non-Goals

**Goals:**

- One parser of test sources, shared by the coverage report, the `tests.md` generator, and the exclude list gate, so the
  three never disagree on which test checks which clause.
- A test file's shape that a reader of the spec and a reader of the test failure both recognise: the failure's full
  name reads as the scenario's clauses.

**Non-Goals:**

- Running the tests. The checker reads source text; whether a step passes is the test runner's job.
- Checking that a scenario's body follows the clause format, beyond the first word of an assertion clause
  (decision 12). `openspec/config.yaml` asks for it when a spec is written, and review checks it; a scenario with no
  clause keyword has no clause to miss.
- Rewriting the assertion clauses of every existing spec. A scenario's clauses are rewritten when its line leaves the
  exclude list.

## Decisions

### 1. Vitest and node tests: GIVEN and WHEN as nested `describe`s

A scenario's test is `describe("<capability>: <scenario>")`, holding an optional `describe("GIVEN ...")`, holding
`describe("WHEN ...")`, holding one `it("THEN ...")` or `it("AND ...")` per outcome clause. An AND after a GIVEN or a
WHEN is a `describe("AND ...")` nested in that `describe`, because it extends a precondition or an action and so
holds no assertion.

Why: a hook has no title, so a GIVEN or WHEN run in a bare `beforeEach` leaves the checker nothing to read. A
nested `describe` carries the title, holds the hook that runs the step, and makes vitest's failure name read
`<capability>: <scenario> > WHEN ... > THEN ...`.

Alternative: one `it` per scenario with the clauses as comments. Rejected: a comment is not part of the failure name,
and the checker reads titles, never comments, so the clauses would have nothing it can match.

Where the step runs is the test author's choice:

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
clause step, so every clause is missing for it: the report names them for a scenario on the exclude list, and a
scenario not on the list fails (decision 8). Counting such a test as covered would hide the drift this change exists to report, and not
counting it would show a scenario with a passing test as uncovered. Context names the files that hold such tests.

### 2. Playwright: one `test.step` per clause; a GIVEN may be an enclosing `test.describe`

A scenario's test is `test("<capability>: <scenario>")` with a `test.step` per clause. A GIVEN is either a
`test.step` in the body or a `test.describe("GIVEN ...")` around the test whose `beforeEach` or `beforeAll` runs the
precondition; a `test.describe.serial("GIVEN ...")` counts as the same form. Both forms count.

Why: where a precondition runs is the test author's choice, as in decision 1. A precondition shared by several scenarios (a seeded
project, a signed-in session) belongs in a hook, and a `test.step` inside a hook is not inside the test's body, so
the enclosing `test.describe` carries the title instead. A `test.step` whose title starts with no clause keyword is
ignored, so a test can keep its helper steps.

### 3. Sources are parsed with the TypeScript compiler API

The checker parses each source file with `ts.createSourceFile` (`typescript` is a dependency of `client-v2`) and
walks the calls of `test`, `test.describe`, `test.step`, `describe`, and `it`, keeping their nesting.

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
- a test whose body calls `test.skip()` or `test.fixme()` with no condition;
- a `node:test` call whose options hold `skip` or `todo` as the literal `true` or a string.

A conditional skip counts as covering the scenario: an in-body `test.skip(<condition>, …)` or
`test.fixme(<condition>, …)`, a `node:test` `skip` or `todo` option holding any other expression, and vitest's
`skipIf` and `runIf`.

Why: the checker reads source text and cannot evaluate a condition such as `browserName === "firefox"` or `!DB`. A
conditionally skipped test runs in some environment, and counting it as skipped would report
`assistant-code-stream: A code block keeps its height while a line streams past its width` as uncovered, though CI
runs it on Chromium. The cost, a test whose condition holds in CI, is in Risks.

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

Why a `node --test` row: the checker and the generator of this change are `.mjs` scripts tested with `node --test`,
under `.claude/skills/quality-spec-coverage/scripts/` and `client-v2/scripts/`, so without that row this capability's
own scenarios could never be covered, and neither could the scenarios of `api/` modules.

### 5. A clause matches a step by normalised text, in order

The scenario's clauses are read as the list items that start with a bold keyword, with indented continuation lines
joined. Each clause and each step title is normalised by collapsing every run of whitespace to one space and removing
the `**` around the keyword; backticks and every other character stay. The test's clause steps, in source order (a
`describe`'s title before the steps nested in it), are matched against the scenario's clauses in order; a clause with
no matching step at its place is missing.

In the vitest and node shape the nesting of decision 1 is part of the match: a step counts only inside the
`describe` of the GIVEN, WHEN, or AND clause before it. An `it("THEN ...")` beside the WHEN `describe`, instead of
inside it, is missing, though it comes after the WHEN in source order. Playwright steps sit in one test body, so for
them the order alone decides.

Why: an order check catches a THEN placed before its WHEN, which a set comparison would accept. The nesting check
catches a THEN whose action never ran for it: an `it` outside the WHEN `describe` runs without the WHEN's hook.
Keeping backticks avoids a second rule for what counts as formatting.

### 6. Report shape

`yarn spec:coverage` prints, per scenario with a finding, the tests that cite it (file, title, level) and each test's
missing clauses; then the candidate duplicates (a scenario more than one test cites, at any level); then the totals
line, extended with the integration and end-to-end counts. Duplicates never change the exit code.

A scenario marked `(manual)` that a test cites is reported as a conflict, and fails the run: the mark says the
scenario needs no test, the test says it has one, and only the author knows which is right. The exclude list cannot
name a `(manual)` scenario, so no line exempts the conflict.

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

A clause the test has no step for gets a row with that test's file and title and a Level reading `missing`, so the
file shows the same gap the coverage report names. A manual scenario has one row whose Level reads `manual` and whose
other cells are empty; an uncovered one, one row whose Level reads `none`. A `|` in a cell is escaped. Scenarios are `##` headings, never `#### Scenario:`, so no
reader of spec headings mistakes the file for a spec. File paths are relative to the repository root.

Why every capability, not only those without a line in the exclude list: the file answers "which tests check this capability" for any reader, and
generating it for some capabilities would add a second list to keep. Why the `checks` job: the check reads only
source text, so it needs no build, unlike `scripts/bundle-info.build-test.mjs`.

### 8. The exclude list is a plain text file beside the checker

`.claude/skills/quality-spec-coverage/excluded.txt` names one `<capability>: <scenario>` per line, the key a test is
titled with; `#` starts a comment line, as in `client-v2/e2e/known-skips.txt`, and blank lines and trailing spaces
are ignored. It names the scenarios of `openspec/specs/` that are not yet up to standard. Until task 2.2 lands, the
standard is a test titled with the key; from task 2.2 on, it is also every clause a step and every assertion clause
starting with a verb, and the scenarios that fall short return to the list in that task's PR.

`yarn spec:coverage` enforces the list on every run, with no flag, so a local run fails where CI fails. It fails on a
scenario that is neither listed, `(manual)`, nor up to standard; on a listed scenario that is up to standard, so the
list never keeps a line that no longer exempts anything; on a listed name that is no scenario of `openspec/specs/` or
is `(manual)`, so a renamed scenario or a manual mark cannot hide behind a line; and on a duplicate line.
`--strict` keeps its meaning: it ignores the list, and any uncovered scenario fails.

Why a list of scenarios, not of capabilities: a list of strict capabilities left every other capability ungated, so a
new uncovered scenario anywhere outside the list passed. A list of gaps gates every scenario from the start and
records each gap by name.

Why outside `openspec/`: the OpenSpec CLI and `/opsx:archive` never read or write the file, and the list governs
the checker, not a spec.

### 9. The list only shrinks; the base-branch comparison reads it with `git show`

`yarn spec:coverage --base <ref>` reads `<ref>:.claude/skills/quality-spec-coverage/excluded.txt` with `git show`
and fails on every line the base branch's list lacks: a new gap needs a test or the `(manual)` mark, not a line. One
added line passes: a line whose scenario is `(manual)` in the base branch's `openspec/specs/`, read with
`git ls-tree -r` and `git show` for each `spec.md`. Dropping a wrong `(manual)` mark turns the scenario into a gap;
without the exception the PR that drops the mark would also have to write the test. A
base branch without the file skips the comparison, so the PR that adds the file passes; treating the missing file as
an empty list would fail every line. A git failure other than a missing path fails the run. On `pull_request` runs
CI fetches the base branch and passes `--base FETCH_HEAD`, as `client-v2/scripts/bundle-info-report.sh` fetches its
base; `push` runs pass nothing. A retired capability's lines leave the list in the PR that deletes its `spec.md`,
because a listed name that is no scenario fails the run, and removing a line always passes the comparison.

### 10. Active changes: only `openspec/specs/` is gated

The gate reads `openspec/specs/` only. A scenario that exists only in an active change's delta is reported and does
not fail the run. A scenario of `openspec/specs/` that an active change modifies or removes is gated by its text in
`openspec/specs/` until the change is archived, so the task that removes a behaviour keeps the behaviour's test until
the archive PR, which removes the scenario and the test together.

`--strict` keeps the meaning decision 8 gives it, so it fails on an uncovered scenario that only an active change
adds, as on any other. `--strict` is a whole-tree check for a developer who asks for it; CI does not pass it.

### 11. Order of pull requests

The proposal lands as a docs-only PR (`client-v2/CLAUDE.md`, "Specs and changes", step 3) holding only this change's
folder. Task 1.1 then moves the rule out of `client-v2/CLAUDE.md` and adds the `config.yaml` line. Until the change is
archived the capability exists only as this change's delta, so the pointer names
`openspec/changes/scenario-tests/specs/scenario-tests/spec.md`, and the archive PR re-points it at
`openspec/specs/scenario-tests/spec.md` (task 6.1). The checker, the generator, the gate, and the pilot
follow in PRs of their own, in the order [tasks.md](tasks.md) gives.

### 12. An assertion clause starts with a verb; the checker rejects a closed list of first words

Every THEN, and every AND after a THEN, starts with a verb after its keyword: "THEN shows the error toast", "THEN
sends no request". GIVEN, WHEN, and an AND after either keep their subject: "WHEN the user deploys". The keyword an
AND follows is the one decision 1 nests it under.

Why: the clause is the test's step title verbatim, and an assertion's subject is the system under test, which the
scenario's title and its WHEN already name, so a subject-first THEN repeats it in every failure name. No rule in
`client-v2/CLAUDE.md` sets it: "A test title says what the code does" accepts "should" or a verb, and the scenario
format, and sets nothing for a clause's first word (Context).

For a scenario not on the exclude list the checker fails an assertion clause whose first word after the keyword is on
the closed list the spec requirement "An assertion clause starts with a verb" names. For a scenario on the exclude list
the report counts such clauses per capability. Review catches a non-verb the closed list misses.

Why a closed list: a verb cannot be detected without a language parser, and a parser would add a dependency and
still misread words that are both a noun and a verb ("reports", "lists"). The listed words are the subjects specs
start THEN clauses with (Context), and none of them is a verb, so the list never rejects a correct clause.

Scope: new scenarios follow the rule through the `rules.specs` line of `openspec/config.yaml` (task 1.1). An existing
scenario is rewritten when its line leaves the exclude list (tasks 5.1 and 5.3 for the pilots), and its test's step
titles follow the rewritten clauses. Other listed scenarios keep their wording; the checker reports their clauses
only.

The pilots edit `openspec/specs/client-v2-custom-rpcs/spec.md` and
`openspec/specs/client-v2-build-server-endpoint/spec.md` directly, for clause wording and `(manual)` marks only,
with no change of behaviour. A `## MODIFIED Requirements` delta would leave the old clauses in `openspec/specs/`
until archive, and the gate reads only those (decision 10), so the pilot would not prove the clause-by-clause gate on
the rewritten clauses it exists to prove.

There are two pilots, and no active change edits either, so the gate is proven without touching other changes.
`client-v2-custom-rpcs` (task 5.1) proves the Playwright steps; `client-v2-build-server-endpoint` (task 5.3) proves
a THEN `it` nested in its WHEN `describe`, in vitest and in `node --test`, which the checker matches by rules of its
own (decision 1), apart from the Playwright steps (decision 2), over the one source tree of decision 3. Its scenarios
have no GIVEN and no AND, so the checker's own tests (task 2.2) cover those `describe`s. The second pilot also
exercises a scenario moving from `(manual)` to tested, a flat test converted to the clause form, and the rule that an
in-source unit block cites no scenario.

### 13. The quality tools: a `quality-` prefix, a skill folder each, and one yarn script

Each quality tool is a Claude Code skill under `.claude/skills/quality-<name>/`, holding its `SKILL.md` and its code
under `scripts/`: `quality-spec-coverage` holds the checker, its tests, and the exclude list; `quality-spec-tests`
writes the missing tests of listed scenarios; `quality-gates` holds the gates linter. A root `Makefile.quality`,
included by the root `Makefile`, gives each developer flow a target, so `make help` lists the tools together:
`quality-spec-coverage`, `quality-spec-coverage-update`, which rewrites the list from the unmet scenarios, and
`quality-lint-gates`.

Only the gate is a yarn script: `yarn spec:coverage` runs the checker, because CI and `yarn run check` call it from
`client-v2/`. Developer-only flows are Make targets and never yarn scripts, so `package.json` lists only what CI runs.
The scripts run through `node`, `yarn`, or `make`, with no shebang and no executable bit.

Why skill folders: a skill finds its code and data beside its instructions, and the prefix groups the tools in
`.claude/skills/` and in `make help`. `yarn test-api` collects `.claude/skills/*/scripts/*.test.mjs`, so the tools'
tests run with the rest, and the checker reads those files as `node --test` sources (decision 4).

## Risks / Trade-offs

- [Many existing assertion clauses start with a listed word, so reporting each one for a listed scenario buries
  the other findings] → For a scenario on the exclude list the report prints one count of such clauses per
  capability; a scenario not on the list has its clauses named one by one.
- [Task 2.2 raises the standard, so its PR adds lines to the exclude list and fails the base comparison] → A
  maintainer merges that PR past the failed check; the check names each added line, so the reason is on record. The
  same holds for any later PR that raises the standard.
- [A scenario that leaves the exclude list while an active change edits it gets subject-first clauses back when
  that change is archived] → The gate reads `openspec/specs/` only, so that archive PR fails until it rewrites those
  clauses; the failure names each clause.
- [An agent's test written by `quality-spec-tests` asserts what the code does rather than what the scenario says] →
  The skill's brief takes assertions from the THEN clauses only, and the test is reviewed in the PR like any other.
- [A GIVEN, WHEN, or AND clause containing "unit", "integration", or "e2e", or a scenario `describe` such as
  `client-v2-unit-tests: <scenario>`, becomes a `describe` title that `jest/valid-title` warns on, and the warning
  raises the total `--max-warnings` caps] → Task 2.3 narrows the rule's disallowed words to `describe` titles that
  start with neither a clause keyword nor `<capability>: `.
- [A test of a scenario not on the exclude list quarantined with an unconditional `.fixme` or `test.fixme()` is uncovered, so every
  PR fails until it is fixed] → Intended: the gate makes the quarantine visible. The PR that quarantines it either
  fixes the test or marks the scenario `(manual)` in the spec, and review sees both. The checker does not read
  `e2e/known-skips.txt`; a quarantine reaches the gate only through a skip in the source.
- [A test whose skip condition holds in CI counts as covered, though CI never runs it] → Accepted, because the
  checker cannot evaluate a condition (decision 3). The case Context names is `e2e/two-tabs.e2e.spec.ts`
  (`test.fixme(!!process.env.CI, …)`), which runs on a laptop only. TODO (ticket to file): settle the runner timing
  in `two-tabs.e2e.spec.ts` so its scenario runs in CI. The other conditional skips are counted as intended:
  `e2e/assistant-code-stream.e2e.spec.ts` (`test.fixme(browserName === "firefox", …)`) runs on Chromium in CI, and
  the database cases of `node --test` files (`{ skip: !DB && "DATABASE_URL not set" }`) skip only on a machine
  without `DATABASE_URL`, which the `checks` job sets, so they run there.
- [Two parallel PRs that retitle tests of one capability both change its `tests.md` and conflict] → The file is
  generated: the second PR rebases and runs `yarn spec:tests`.
- [A scenario's clause wording is copied into a test title, so a long clause makes a long test name] → Accepted: the
  failure name then reads as the spec.
- [A test title built in a loop (`it.each`, `it(label, ...)`) cannot cite a scenario] → Such a test checks one
  module's table of cases, which is the unit level; a scenario needs literal titles.
- [Adding a line in an emergency fails the base comparison] → The PR that adds it is merged past the failed check by
  a maintainer; the check names the line, so the reason is on record.
