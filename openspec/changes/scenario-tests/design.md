# Design

## Context

See [proposal.md](proposal.md), "Why". The facts below were read at `de036c4a6`.

- `client-v2/scripts/spec-coverage.mjs` reads scenarios from `openspec/specs/` and from active changes, reads test
  titles from `e2e/` with a regular expression (`TEST_TITLE`, the first double-quoted argument of `test(` or
  `test.only(`), and reports. `--strict` exits with an error on any uncovered scenario; the `checks` job of
  `.github/workflows/reusable-client-v2.yml` runs it without `--strict`.
- The `checks` job checks out with `fetch-depth: 0`, so a pull request's base branch is available to `git show`.
- Only `e2e/client-v2-layout.e2e.spec.ts` uses `test.step`.
- `openspec validate --all --strict` (pinned CLI 1.14.0) passes with a `tests.md` beside a `spec.md` under
  `openspec/specs/`, and ignores a `#### Scenario:` heading inside it. `/opsx:archive` writes only `spec.md`;
  retiring a capability deletes only `spec.md`.
- `jest/valid-title` warns on "unit", "integration", and "e2e" in a `describe` title in `src/**/*.{test,spec}.*`
  (`"warn"` in `client-v2/eslint.config.mjs`; `client-v2/CLAUDE.md`, "What review keeps finding"). A warning does not
  change the exit code of `yarn lint` until the total passes `--max-warnings`. The same section asks for test titles
  that start with a verb ("A test title says what the code does").
- `vitest.config.ts` collects `src/**/*.{spec,test}.{js,jsx,ts,tsx,mts}` and `src/**/__tests__/**` (`include`), and
  `client-v2/AGENTS.md` requires `<name>.test.mts` for a module the Playwright suite imports.
- Most THEN clauses in `openspec/specs/` start with a subject: about 514 with "the", followed by "it", "no", "a",
  "its", and a backtick.

## Goals / Non-Goals

**Goals:**

- One parser of test sources, shared by the coverage report, the `tests.md` generator, and the strict gate, so the
  three never disagree on which test checks which clause.
- A test file's shape that a reader of the spec and a reader of the test failure both recognise: the failure's full
  name reads as the scenario's clauses.

**Non-Goals:**

- Running the tests. The checker reads source text; whether a step passes is the test runner's job.
- Checking that a scenario's body follows the clause format, beyond the first word of an assertion clause
  (decision 12). `openspec/config.yaml` asks for it when a spec is written, and review checks it; a scenario with no
  clause keyword has no clause to miss.
- Rewriting the assertion clauses of every existing spec. A capability is rewritten when it joins the strict list.

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

The same shape applies to `node --test` files, whose `describe`, `it`, `before`, and `beforeEach` come from
`node:test`.

### 2. Playwright: one `test.step` per clause; a GIVEN may be an enclosing `test.describe`

A scenario's test is `test("<capability>: <scenario>")` with a `test.step` per clause. A GIVEN is either a
`test.step` in the body or a `test.describe("GIVEN ...")` around the test whose `beforeEach` or `beforeAll` runs the
precondition. Both forms count.

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

A title counts when it is a string literal or a template literal without a substitution. A skipped call does not
count: `.skip`, `.fixme`, and `.todo` on `test`, `it`, and `describe`, `test.describe.skip` included.

### 4. Sources and levels follow the file's path

| Source                                                                | Level       |
| --------------------------------------------------------------------- | ----------- |
| `client-v2/e2e/**/*.ts`                                               | end-to-end  |
| the files the `include` globs of `client-v2/vitest.config.ts` collect | integration |
| the `*.test.mjs` files the `test-api` script of `package.json` runs   | integration |

The checker reads `include` from `vitest.config.ts` instead of keeping a list of its own, so a test file vitest runs,
such as a `<name>.test.mts` that `client-v2/AGENTS.md` requires, is never invisible to the checker.

In-source blocks are never read: `includeSource` is not a source, so a scenario title in a unit block leaves the
scenario uncovered.

Why a `node --test` row: the checker and the generator of this change are `.mjs` scripts tested with `node --test`
under `client-v2/scripts/`, so without that row this capability's own scenarios could never be covered, and neither
could the scenarios of `api/` modules.

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

A manual scenario has one row whose Level reads `manual` and whose other cells are empty; an uncovered one, one row
whose Level reads `none`. A `|` in a cell is escaped. Scenarios are `##` headings, never `#### Scenario:`, so no
reader of spec headings mistakes the file for a spec. File paths are relative to the repository root.

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

### 10. Active changes: added scenarios are reported, modified ones are matched by name

The gate reads `openspec/specs/` only. A scenario that exists only in an active change's delta is reported. A
scenario of a requirement listed under `## MODIFIED Requirements` in any active change's delta for that capability is
gated by its name only: its test must exist, its clauses are not compared. When the change is archived, the clauses
of `openspec/specs/` are compared again, and archiving needs every task ticked, so the test is updated by then.

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

Why: the clause is the test title verbatim, and `client-v2/CLAUDE.md` ("A test title says what the code does") asks
for a title that starts with a verb. An assertion's subject is the system under test, which the scenario's title
and its WHEN already name.

In a strict capability the checker fails an assertion clause whose first word after the keyword is on the closed
list the spec requirement "An assertion clause starts with a verb" names. Outside the strict list the report counts
such clauses per capability. Review catches a non-verb the list misses.

Why a closed list: a verb cannot be detected without a language parser, and a parser would add a dependency and
still misread words that are both a noun and a verb ("reports", "lists"). The listed words are the subjects specs
start THEN clauses with (Context), and none of them is a verb, so the list never rejects a correct clause.

Scope: new scenarios follow the rule through the `rules.specs` line of `openspec/config.yaml` (task 1.1). An existing
capability is rewritten when it joins the strict list (tasks 5.1 and 5.3 for the pilots), and its tests' step
titles follow the rewritten clauses. Other existing specs keep their wording; the checker reports their clauses only.

There are two pilots, and no active change edits either, so the gate is proven without touching other changes.
`client-v2-custom-rpcs` (task 5.1) proves the Playwright steps; `client-v2-build-server-endpoint` (task 5.3) proves
the vitest `describe` nesting, which the checker matches by rules of its own (decision 1), apart from the Playwright
steps (decision 2), over the one source tree of decision 3. The second pilot also exercises a
scenario moving from `(manual)` to tested, and the rule that an in-source unit block cites no scenario.

## Risks / Trade-offs

- [About 600 existing assertion clauses start with a listed word, so reporting each one off the strict list buries
  the other findings] → Off the strict list the report prints one count of such clauses per capability; a strict
  capability's clauses are named one by one.
- [A capability that joins the strict list while an active change edits it gets subject-first clauses back when
  that change is archived] → The gate reads `openspec/specs/` only, so that archive PR fails until it rewrites those
  clauses; the failure names each clause.
- [A GIVEN, WHEN, or AND clause containing "unit", "integration", or "e2e", or a scenario `describe` such as
  `client-v2-unit-tests: <scenario>`, becomes a `describe` title that `jest/valid-title` warns on, and the warning
  raises the total `--max-warnings` caps] → Task 2.3 narrows the rule's disallowed words to `describe` titles that
  start with neither a clause keyword nor `<capability>: `.
- [A strict capability's test quarantined with `test.fixme`, or listed in `e2e/known-skips.txt`, is uncovered, so
  every PR fails until it is fixed] → Intended: the gate makes the quarantine visible. The PR that quarantines it
  either fixes the test or marks the scenario `(manual)` in the spec, and review sees both.
- [Two parallel PRs that retitle tests of one capability both change its `tests.md` and conflict] → The file is
  generated: the second PR rebases and runs `yarn spec:tests`.
- [A scenario's clause wording is copied into a test title, so a long clause makes a long test name] → Accepted: the
  failure name then reads as the spec.
- [A test title built in a loop (`it.each`, `it(label, ...)`) cannot cite a scenario] → Such a test checks one
  module's table of cases, which is the unit level; a scenario needs literal titles.
- [Reverting the strict list in an emergency fails the base comparison] → Removing a capability needs a PR that a
  maintainer merges past the failed check; the check names the capability, so the reason is on record.
