# Proposal

## Why

A spec scenario is checked only by its title: `spec:coverage` finds a Playwright test named
`<capability>: <scenario>` and never reads what the test does, so a test can keep the title after the scenario's
WHEN or THEN is reworded and nothing reports the drift. A vitest test that checks a scenario is invisible to the
checker (`BaseBuild.test.tsx`, `server.test.ts`, `IdlBuildGuide.test.tsx` and `agent.integration.spec.ts` cite
scenarios only in comments), and CI never fails on an uncovered scenario. The rule itself, "Scenarios are the test
plan", lives only in `client-v2/CLAUDE.md`, so no spec states it and no requirement can be checked against it.

## What Changes

- A capability `scenario-tests` owns the rule that every scenario is a test or is marked `(manual)`, and the
  levels a scenario is checked at: integration (a vitest or `node --test` file, several layers or slices, no
  browser) and end-to-end (Playwright under `e2e/`, a real browser or a real environment). The author picks between
  them by these criteria, and review checks the choice. A unit test, as `client-v2-unit-tests` defines it, cites no
  scenario. The checker takes a test's level from its file's path, so a single-module test that keeps a `*.test.ts`
  file and cites a scenario is reported at the integration level.
- A scenario's clauses are GIVEN (optional), WHEN, THEN, and AND, and each one is a titled step in its test. The
  steps nest, in both runners. A GIVEN, a WHEN, and an AND after either is a container that holds every clause after
  it: a `test.step` in Playwright, a `describe` in vitest and `node --test`. A THEN, and an AND after a THEN, is a leaf
  in the container of its WHEN: a `test.step` in Playwright, an `it` in vitest and `node --test`. A scenario may hold
  a later WHEN after a THEN, nested in the WHEN before it. One rule matches a clause to its step in both runners. A
  clause reworded in the spec is a mismatch until the test is updated, and a step titled with a clause the scenario
  does not hold is reported.
- An assertion clause (every THEN, and every AND after a THEN) starts with a verb after its keyword ("THEN shows
  the error toast"), a rule this change introduces: the clause is the test's step title verbatim, and its subject is
  the system under test, which the scenario already names. The checker holds the rule in a positive form: the first
  word is lower-case letters only and ends in "s", and is not on a short list of words that end in "s" and are not
  verbs. `client-v2/CLAUDE.md` ("A test title says what the code does") accepts "should" or a verb and sets nothing
  for a clause. GIVEN, WHEN, and an AND after them keep a subject. The rule applies to a scenario written after task
  1.1, through the `config.yaml` line, and to strict capabilities: a capability's assertion clauses are rewritten
  when it joins the strict list. Other existing specs stay as they are.
- Review holds two more rules, which the `config.yaml` line also states. An assertion clause holds no user action
  and no condition: an action is a WHEN, so an action after a THEN is a later WHEN, and a condition is a GIVEN or
  part of the WHEN. A clause of a strict capability names the values its test uses, with no placeholder such as
  `{name}`, because the step title is the clause verbatim.
- `spec:coverage` reads the vitest files `vitest.config.ts` collects and the `node --test` files `yarn test-api`
  runs, as well as `e2e/`, and reports per scenario: its tests, their level, missing clauses, clause steps that match
  no clause, and scenarios more than one test cites. Off the strict list the report is compact: a test with no clause
  step takes one line, and clauses are named only for a test that has at least one clause step. A flat `it` or `test`
  titled with a scenario cites it and holds no clause step, and a `(manual)` scenario a test cites is a conflict. A
  test skipped under a condition the checker cannot evaluate counts as covering its scenario; only an unconditional
  skip does not.
- Each capability under `openspec/specs/` gets a generated, committed `tests.md`: one row per clause naming the test
  file, test title, and level, "missing" for a clause the test has no step for, "manual", or "none". CI and `yarn run check`
  fail when a committed `tests.md` differs from the generator's output.
- A committed list of strict capabilities: CI fails on an uncovered scenario, a missing clause, a clause step that
  matches no clause, or an assertion clause whose first word breaks the verb rule in a listed capability, and on a PR
  that drops a capability its base branch lists. The other capabilities stay report-only. `scenario-tests` joins the
  list when the change is archived.
- `client-v2/CLAUDE.md` points at the spec instead of restating the rule, and so do the two places that cite the
  rule by title. `openspec/config.yaml` gains a `rules.specs` line on the clause format, the verb-first assertion
  clause, and the two rules review holds, so every `/opsx:*` command writes scenarios in it, and its archive guidance
  runs `yarn spec:tests`. `jest/valid-title` stops warning on "unit", "integration", or "e2e" in a clause `describe`
  or a scenario `describe`.
- Two pilots rewrite a capability's assertion clauses to start with a verb, convert its tests to nested clause
  steps, and put the capability on the strict list: `client-v2-custom-rpcs` for Playwright steps, and
  `client-v2-build-server-endpoint` for a THEN nested in its WHEN `describe`, where scenarios marked `(manual)` gain
  an integration test, the two flat `node --test` cases of `scripts/server-url-gate.test.mjs` take the clause form,
  and the scenario comments leave the in-source unit blocks. A pilot may also, without changing behaviour, move a
  condition into a GIVEN, split a clause into a later WHEN and its THEN, and replace a placeholder or an example
  value with the value the test uses. The conversion adds an assertion for a clause part that had none, and keeps an
  assertion beyond the clauses in a step titled with no clause keyword.
- Telemetry: no slice under `features/` or `widgets/` changes; the change adds, renames, and removes no telemetry
  event, and touches no funnel step's code.

User-visible consequence: none in the product. A contributor sees which clause of a scenario has no step, which
step names a clause its scenario does not hold, which tests check a capability in its `tests.md`, and a failed check
when a strict capability's test falls behind its spec.

## Capabilities

### New Capabilities

- `scenario-tests`: how a spec scenario maps to a test, the test levels, the clause-to-step format and its nesting,
  the verb-first assertion clause, the two clause rules review holds, the coverage report, the generated `tests.md`,
  and the per-capability strict gate.

### Modified Capabilities

None by delta. `client-v2-unit-tests` keeps its requirements, and a unit test cites no scenario.

The pilots edit two capabilities directly in `openspec/specs/`, with no change of behaviour: `client-v2-custom-rpcs`
(task 5.1) and `client-v2-build-server-endpoint` (task 5.3). The edits cover clause wording, `(manual)` marks, a
condition moved into a GIVEN, a clause split into a later WHEN and its THEN, and a placeholder or an example value
replaced by the value the test uses. Task 5.1 also decides whether a case that a moved condition leaves out of
"Editing renames the chip" gets a scenario of its own. A scenario the pilot adds is written directly in
`openspec/specs/client-v2-custom-rpcs/spec.md`, like the pilot's other edits, and gets its test in the same pull
request or the `(manual)` mark, so task 5.2 does not put a capability with an uncovered scenario on the strict list.
A delta would put the rewritten scenarios under the name-only exemption until archive (design.md, decisions 10 and
12).

## Impact

- Code: `client-v2/scripts/spec-coverage.mjs` and its tests, a `tests.md` generator under `client-v2/scripts/`,
  the strict list `client-v2/scripts/spec-coverage-strict.txt`, `client-v2/package.json` scripts, the `jest/valid-title` rule in `client-v2/eslint.config.mjs`, the `checks` job of
  `.github/workflows/reusable-client-v2.yml`, the tests of
  `client-v2-custom-rpcs` in `client-v2/e2e/client-v2-custom-rpcs.e2e.spec.ts`, the clauses of
  `openspec/specs/client-v2-custom-rpcs/spec.md`; for `client-v2-build-server-endpoint`, the added test file
  `client-v2/src/settings/server/build-server-endpoint.test.ts`, `client-v2/scripts/server-url-gate.test.mjs`, the
  scenario comments in `client-v2/src/settings/server/default-endpoint.ts`,
  `client-v2/src/settings/server/server.test.ts`, and `client-v2/src/settings/stored-endpoint.ts`, and `openspec/specs/client-v2-build-server-endpoint/spec.md`;
  `client-v2/CLAUDE.md`, and `openspec/config.yaml`.
- Generated files: one `openspec/specs/<capability>/tests.md` per capability.
- Order: this proposal lands as a docs-only PR first; the checker, the generator, the gate, and the pilots follow in
  PRs of their own.
- Out of scope: mutation testing (Stryker), until its support for vitest 5 is checked; a Gherkin runner; rewriting
  existing tests into clause steps beyond the two pilot capabilities; rewriting the assertion clauses of a capability that
  is not on the strict list; splitting a THEN that holds several assertions into one clause per assertion when a
  capability joins the strict list; a check by script that an assertion clause holds no action or condition, or
  that a clause names its test's values; a `tests.md` for a change's delta spec, which is a
  proposal until it is archived; any change to how unit tests are written.
