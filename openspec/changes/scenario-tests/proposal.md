# Proposal

## Why

A spec scenario is checked only by its title: `spec:coverage` finds a Playwright test named
`<capability>: <scenario>` and never reads what the test does, so a test can keep the title after the scenario's
WHEN or THEN is reworded and nothing reports the drift. A vitest test that checks a scenario is invisible to the
checker (`BaseBuild.test.tsx`, `server.test.ts`, `IdlBuildGuide.test.tsx` and `agent.integration.spec.ts` cite
scenarios only in comments), and CI never fails on an uncovered scenario. The rule itself, "Scenarios are the test
plan", lives only in `client-v2/CLAUDE.md`, so no spec states it and no requirement can be checked against it.

## What Changes

- A new capability `scenario-tests` owns the rule that every scenario is a test or is marked `(manual)`, and the
  levels a scenario is checked at: integration (a vitest or `node --test` file, several layers or slices, no
  browser) and end-to-end (Playwright under `e2e/`, a real browser or a real environment). The author picks between
  them by these criteria, and review checks the choice. A unit test, as `client-v2-unit-tests` defines it, cites no
  scenario. The checker takes a test's level from its file's path, so a single-module test that keeps a `*.test.ts`
  file and cites a scenario is reported at the integration level.
- A scenario's clauses are GIVEN (optional), WHEN, THEN, and AND, and each one is a titled step in its test: a
  `test.step` per clause in Playwright, nested `describe` and `it` titles in vitest. A clause reworded in the spec
  is a mismatch until the test is updated.
- An assertion clause (every THEN, and every AND after a THEN) starts with a verb after its keyword ("THEN shows
  the error toast"), a rule this change introduces: the clause is the test's step title verbatim, and its subject is
  the system under test, which the scenario already names. `client-v2/CLAUDE.md` ("A test title says what the code
  does") accepts "should" or a verb and sets nothing for a clause. GIVEN, WHEN, and an AND after them keep a subject.
  The rule applies to new scenarios, through the `config.yaml` line, and to strict capabilities: a capability's
  assertion clauses are rewritten when it joins the strict list. Other existing specs stay as they are.
- `spec:coverage` reads the vitest files `vitest.config.ts` collects and the `node --test` files `yarn test-api`
  runs, as well as `e2e/`, and reports per scenario: its tests, their level, missing clauses, and scenarios more than
  one test cites. A flat `it` or `test` titled with a scenario cites it with every clause missing, and a `(manual)`
  scenario a test cites is a conflict. A test skipped under a condition the checker cannot evaluate counts as
  covering its scenario; only an unconditional skip does not.
- Each capability under `openspec/specs/` gets a generated, committed `tests.md`: one row per clause naming the test
  file, test title, and level, "missing" for a clause the test has no step for, "manual", or "none". CI and `yarn run check`
  fail when a committed `tests.md` differs from the generator's output.
- A committed list of strict capabilities: CI fails on an uncovered scenario, a missing clause, or an assertion
  clause whose first word is on a closed list of non-verbs in a listed capability, and on a PR that drops a
  capability its base branch lists. The other capabilities stay report-only. `scenario-tests` joins the list when
  the change is archived.
- `client-v2/CLAUDE.md` points at the spec instead of restating the rule, and so do the two places that cite the
  rule by title. `openspec/config.yaml` gains a `rules.specs` line on the clause format and the verb-first assertion
  clause, so every `/opsx:*` command writes new scenarios in it, and its archive guidance runs `yarn spec:tests`.
  `jest/valid-title` stops warning on "unit", "integration", or "e2e" in a clause `describe` or a scenario
  `describe`.
- Two pilots rewrite a capability's assertion clauses to start with a verb, convert its tests to clause steps, and
  put the capability on the strict list: `client-v2-custom-rpcs` for Playwright steps, and
  `client-v2-build-server-endpoint` for a THEN nested in its WHEN `describe`, where scenarios marked `(manual)` gain
  an integration test, the two flat `node --test` cases of `scripts/server-url-gate.test.mjs` take the clause form,
  and the scenario comments leave the in-source unit blocks.
- Telemetry: no slice under `features/` or `widgets/` changes; the change adds, renames, and removes no telemetry
  event, and touches no funnel step's code.

User-visible consequence: none in the product. A contributor sees which clause of a scenario has no step, which
tests check a capability in its `tests.md`, and a failed check when a strict capability's test falls behind its
spec.

## Capabilities

### New Capabilities

- `scenario-tests`: how a spec scenario maps to a test, the test levels, the clause-to-step format, the verb-first
  assertion clause, the coverage report, the generated `tests.md`, and the per-capability strict gate.

### Modified Capabilities

None by delta. `client-v2-unit-tests` keeps its requirements, and a unit test cites no scenario.

The pilots edit two capabilities directly in `openspec/specs/`, for clause wording and `(manual)` marks only, with no
change of behaviour: `client-v2-custom-rpcs` (task 5.1) and `client-v2-build-server-endpoint` (task 5.3). A delta
would put the rewritten scenarios under the name-only exemption until archive (design.md, decisions 10 and 12).

## Impact

- Code: `client-v2/scripts/spec-coverage.mjs` and its tests, a `tests.md` generator under `client-v2/scripts/`,
  the strict list `client-v2/scripts/spec-coverage-strict.txt`, `client-v2/package.json` scripts, the `jest/valid-title` rule in `client-v2/eslint.config.mjs`, the `checks` job of
  `.github/workflows/reusable-client-v2.yml`, the tests of
  `client-v2-custom-rpcs` in `client-v2/e2e/client-v2-custom-rpcs.e2e.spec.ts`, the assertion clauses of
  `openspec/specs/client-v2-custom-rpcs/spec.md`; for `client-v2-build-server-endpoint`, a new
  `client-v2/src/settings/server/build-server-endpoint.test.ts`, `client-v2/scripts/server-url-gate.test.mjs`, the
  scenario comments in `client-v2/src/settings/server/default-endpoint.ts`,
  `client-v2/src/settings/server/server.test.ts`, and `client-v2/src/settings/stored-endpoint.ts`, and `openspec/specs/client-v2-build-server-endpoint/spec.md`;
  `client-v2/CLAUDE.md`, and `openspec/config.yaml`.
- Generated files: one `openspec/specs/<capability>/tests.md` per capability.
- Order: this proposal lands as a docs-only PR first; the checker, the generator, the gate, and the pilots follow in
  PRs of their own.
- Out of scope: mutation testing (Stryker), until its support for vitest 5 is checked; a Gherkin runner; rewriting
  existing tests into clause steps beyond the two pilot capabilities; rewriting the assertion clauses of a capability that
  is not on the strict list; a `tests.md` for a change's delta spec, which is a
  proposal until it is archived; any change to how unit tests are written.
