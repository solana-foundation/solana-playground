# Tasks

This change's proposal lands first as a docs-only PR. After it, 1.1 and 2.1 may run at the same time; 2.3 follows
1.1, because both rewrite the item "A test title says what the code does" in `client-v2/CLAUDE.md`; 2.2 follows 2.1;
groups 3 and 4 follow 2.2 and may run at the same time; 5.1 follows 3.1 and 4.1; 5.2 follows 4.2 and 5.1; 5.3
follows 2.2, 3.1, 4.1, and 4.2. Each task that changes `client-v2/scripts/` titles its `node --test` cases with the
`scenario-tests` scenarios it implements, in the clause shape of design.md, decision 1.

## 1. The rule moves to the spec

- [ ] 1.1 Replace the "Scenarios are the test plan" paragraph in `client-v2/CLAUDE.md` with a pointer to
  `openspec/changes/scenario-tests/specs/scenario-tests/spec.md`, make the "A test title says what
  the code does" rule cite the spec instead of the paragraph's title, and add a `rules.specs` line to
  `openspec/config.yaml`, after the `**Area:**` rule: a scenario's clauses are GIVEN (optional), WHEN, THEN, and AND,
  each becoming a titled test step; every THEN and every AND after a THEN starts, after its keyword, with a verb in
  lower-case letters that ends in "s" ("shows", "saves"), and holds no user action and no condition (an action is a
  WHEN, a condition is a GIVEN or part of the WHEN); and a clause of a strict capability names the values its test
  uses, with no placeholder such as `{name}`;
  reword the header comment of `openspec/config.yaml`, which says the rules live in `client-v2/CLAUDE.md` and are not
  repeated, since `rules.specs` holds spec-writing rules of its own; verify with `yarn spec:validate` and with
  `openspec instructions specs --change <any active change> --json` listing the added rule (ticket to file)

## 2. The checker

- [ ] 2.1 Parse `e2e/`, the vitest files the `include` globs of `client-v2/vitest.config.ts` collect (read from the
  config, not copied), and the `*.test.mjs` files `yarn test-api` runs with `ts.createSourceFile` into a tree of titled
  `test`, `test.describe`, `test.step`, `describe`, and `it` calls, replacing `TEST_TITLE` in
  `client-v2/scripts/spec-coverage.mjs`; read a member call other than a skip form (`skip`, `fixme`, `todo`,
  `skipIf`, `runIf`, and `test.step.skip`) as its base call, such as `test.only`, `describe.only`, `it.only`,
  `describe.concurrent`, and `it.fails`; read a call whose callee is a call of `skipIf` or `runIf`, as in
  `describe.skipIf(condition)("title", fn)`, as the base call of that member, conditionally skipped; count literal
  titles only; skip an unconditional skip (`.skip`, `.fixme`,
  and `.todo` on `test`, `it`, and `describe`, `test.describe.skip` and `test.describe.fixme` included, an in-body
  `test.skip()` or `test.fixme()` with no argument as a statement of the body itself, an in-body `test.skip(true, …)`
  or `test.fixme(true, …)` with the literal `true`, and a `node:test` `skip` or `todo` option that is `true` or a
  string) and count a conditional one, a `test.skip()` or `test.fixme()` with no argument inside an `if` included;
  report a `(manual)` scenario a test cites as a conflict; and assign each file
  its level by path (design.md, decisions 3, 4, and 6); verify with `node --test scripts/spec-coverage.test.mjs`
  covering the scenarios of "Every scenario is a test or is marked manual" except "A manual scenario a test cites",
  which needs the strict list of 4.1, and the scenarios of "A scenario is checked at the integration or the
  end-to-end level" and "Titles are string literals"; among them "A test inside a skipped describe", "A test inside
  a describe with a modifier", "A node test skipped with the literal true", "A vitest test skipped with skipIf", "A
  test that skips itself with the literal true", "A zero-argument skip inside an if", and "A title in single quotes"
  (ticket to file)
- [ ] 2.2 Read each scenario's clauses (GIVEN included, wrapped lines joined), normalise them and the step titles,
  and match them by nesting, with one rule for both runners (design.md, decision 5): the step of a container clause
  becomes the current container, the step of an assertion clause is a leaf in it, a later WHEN nests in the WHEN
  before it, a step with no clause keyword passes its clause steps to its parent, a `test.step.skip` is no step of
  its clause, a missing container is named without the clauses under it, and a clause step that no clause took is
  reported; count a flat `it` or `test` titled with a scenario as citing it with no clause step (decision
  1); and report per scenario its tests,
  levels, findings, and the candidate duplicates, in the compact form off the strict list (decision 6); point the
  script's docblock at the capability's spec instead
  of the rule's title; depends on 2.1; verify with `node --test scripts/spec-coverage.test.mjs` covering the
  scenarios of "Each clause of a scenario is a titled step of its test", "A clause is matched to its step by
  nesting", "A Playwright test carries its clauses as nested steps", "A vitest or node test carries its clauses as
  nested titles", "A step with no clause keyword is not a clause step", "Clause text matches after whitespace and
  emphasis are normalised", and "The coverage report lists tests, levels, missing clauses, and duplicates", and the
  scenario "A clause step that matches no clause off the strict list" (ticket to file)
- [ ] 2.3 Narrow the `mustNotMatch.describe` pattern of `jest/valid-title` ("unit", "integration", "e2e") in
  `client-v2/eslint.config.mjs`
  to `describe` titles that start with neither a clause keyword nor `<capability>: `, so a GIVEN, WHEN, or AND
  `describe` and a scenario `describe` such as `client-v2-unit-tests: <scenario>` may hold them; update the item "A
  test title says what the code does" in `client-v2/CLAUDE.md` to the narrowed rule; depends on 1.1, which rewrites
  the same item; the rule warns, so verify with
  `yarn eslint <file>` printing no `jest/valid-title` warning for `describe("WHEN ... integration ...")` and
  `describe("client-v2-unit-tests: ...")`, and printing one for `describe("integration ...")` (ticket to file)

## 3. Generated tests.md

- [ ] 3.1 Add `yarn spec:tests` to write `openspec/specs/<capability>/tests.md` for every capability with a
  `spec.md`, from `openspec/specs/` only, in the format of design.md, decision 7, with one row per clause, a
  container clause included, and a `missing` row for a clause the
  test has no step for, and to delete a `tests.md` beside no `spec.md`; `yarn spec:tests --check` writes
  nothing and fails naming each stale or missing file and the command; commit the generated files, add the `--check` step to
  the `checks` job of `.github/workflows/reusable-client-v2.yml` after "Scenario coverage", and add
  `yarn spec:tests --check` to the `check` script of `client-v2/package.json` after `yarn spec:coverage`, so
  `yarn run check` runs what the job runs; add "run `yarn spec:tests` and commit the
  result" to the archive procedure, in `operations.archive.guidance` of `openspec/config.yaml` and in step 5 of
  "Specs and changes" in `client-v2/CLAUDE.md`, since archiving changes `specs/`; depends on 2.2; verify with
  `node --test scripts/spec-tests.test.mjs` covering the scenarios of "Each capability has a generated tests.md" and
  "CI fails on a stale tests.md", and with `yarn spec:validate` passing over the generated files (ticket to file)

## 4. The strict gate

- [ ] 4.1 Add `client-v2/scripts/spec-coverage-strict.txt` (one capability per line, `#` comments, no capability
  yet) and enforce it on every `yarn spec:coverage` run: an uncovered scenario or a missing clause in a listed
  capability, a clause step there that matches no clause, an assertion clause of `openspec/specs/` there whose first
  word breaks the rule of the spec requirement "An assertion clause starts with a verb", a `(manual)` scenario there
  that a test cites, or a listed name with no `spec.md`, exits
  with an error; the report prints one count per capability of the assertion clauses that break that rule and do not
  fail the run: every such clause of a capability off the list, in `openspec/specs/` and in active changes, and a
  listed capability's clauses in an active change's delta; a scenario only an active change adds
  is reported; a scenario of a requirement an active change modifies is matched by name only; a scenario of a
  requirement an active change removes is reported and not gated; `--strict` keeps failing on any uncovered
  scenario, one an active change adds or removes included (design.md, decision 10); replace the
  "Report only" comment above the "Scenario coverage" step of `.github/workflows/reusable-client-v2.yml` with one
  that says the step fails on the strict list; depends on 2.2; verify with
  `node --test scripts/spec-coverage.test.mjs` covering the scenarios of "A listed capability gates its scenarios",
  "An assertion clause starts with a verb", and "An active change does not gate its own scenarios", among them "A
  subject-first clause in an active change's delta for a strict capability" and "A proposal removes a scenario whose
  test is gone, with the strict flag", and the scenarios "A manual scenario a test cites" and "A clause step that
  matches no clause in a strict capability" (ticket to file)
- [ ] 4.2 Add `--base <ref>`, reading the base branch's list with `git show` (a missing file is an empty list), fail
  on a dropped capability whose `spec.md` stays, and pass `--base origin/${{ github.base_ref }}` from the
  "Scenario coverage" step of the `checks` job on `pull_request` runs only; depends on 4.1; verify with
  `node --test scripts/spec-coverage.test.mjs` covering the scenarios of "A pull request cannot drop a strict
  capability" against a temporary git repository (ticket to file)

## 5. Pilots: `client-v2-custom-rpcs` and `client-v2-build-server-endpoint`

- [ ] 5.1 Rewrite every THEN clause, and every AND after a THEN, in `openspec/specs/client-v2-custom-rpcs/spec.md`
  to start with a verb, without changing behaviour; where a clause breaks the spec requirement "An assertion clause
  holds no user action and no condition" or "A clause names the values its test uses", move the condition into a
  GIVEN, split the clause into a later WHEN and its THEN, or replace the placeholder or the example value with the
  value the test uses, a cluster address moving to a test host (design.md, Risks); give each tested scenario's test
  nested `test.step`s, one per clause, titled with the rewritten clauses (design.md, decisions 2 and 5; at
  `8c8d5460b` the capability has 20 tested scenarios, all end-to-end, in
  `client-v2/e2e/client-v2-custom-rpcs.e2e.spec.ts`, and no vitest file cites it), keeping the test titles;
  add an assertion for a clause part that has none, and keep an assertion beyond the clauses in a step titled with no
  clause keyword; settle two details (design.md, decision 12): whether an RPC that is not picked gets a scenario of
  its own, since "Editing renames the chip" covers only a picked RPC once its condition is a GIVEN, and the THEN
  after "Use anyway" in "Offline, nothing is sent", which names what its test asserts (the chip is checked); write a
  scenario the task adds directly in `openspec/specs/client-v2-custom-rpcs/spec.md`, like the task's other edits, and
  give it its test in this pull request or the `(manual)` mark, so 5.2 puts no capability with an uncovered scenario
  on the strict list;
  and regenerate `openspec/specs/client-v2-custom-rpcs/tests.md`; depends on 3.1 and 4.1; verify with
  `yarn spec:coverage` reporting no uncovered scenario, no missing clause, no clause step that matches no clause, and
  no assertion clause that breaks the verb rule for
  `client-v2-custom-rpcs`, and with `yarn test-e2e e2e/client-v2-custom-rpcs.e2e.spec.ts` passing (ticket to file)
- [ ] 5.2 Add `client-v2-custom-rpcs` to `client-v2/scripts/spec-coverage-strict.txt`; depends on 4.2 and 5.1; 5.3
  appends a line to the same file, so the later of the two pull requests rebases onto the other's line;
  verify that the `checks` job passes, and that renaming one `client-v2-custom-rpcs` step locally makes
  `yarn spec:coverage` exit with an error (ticket to file)
- [ ] 5.3 Pilot the vitest and node forms on `client-v2-build-server-endpoint`, whose 6 scenarios are all
  `(manual)` at `8c8d5460b`: rewrite every THEN clause, and every AND after a THEN, in
  `openspec/specs/client-v2-build-server-endpoint/spec.md` to start with a verb, without changing behaviour, and
  rewrite a clause that breaks "An assertion clause holds no user action and no condition" or "A clause names the
  values its test uses" as 5.1 does;
  a WHEN may be reworded to the condition the integration test reproduces, again without changing what the scenario
  asserts (for "A fresh checkout": `REACT_APP_SERVER_URL` unset and an empty stored profile, in place of `yarn dev`
  and a fresh profile); write "A fresh checkout", "The variable is set", and "A stored choice without the variable",
  which `src/settings/server/default-endpoint.ts`, `src/settings/server/server.test.ts`, and
  `src/settings/stored-endpoint.ts` cite in comments, in `src/settings/server/build-server-endpoint.test.ts` as
  `describe(<scenario>) > describe("WHEN ...") > it("THEN ...")` (design.md, decision 1); convert the two flat
  `test()` cases of `scripts/server-url-gate.test.mjs`, "A preview build without the variable" and "A CI build", to
  the same shape with `node:test` (integration, design.md, decision 4); drop the `(manual)` mark of those five
  scenarios, and keep it on "The sources are searched" (a search of the tracked tree); remove
  the scenario comments from the in-source blocks of `default-endpoint.ts` and `stored-endpoint.ts`, which are unit
  level and cite no scenario, keeping their tests, and the comment in `server.test.ts` once
  `build-server-endpoint.test.ts` checks that scenario; add `client-v2-build-server-endpoint` to
  `client-v2/scripts/spec-coverage-strict.txt` and regenerate
  `openspec/specs/client-v2-build-server-endpoint/tests.md`; depends on 2.2, 3.1, 4.1, and 4.2, and may run beside
  5.1 and 5.2; 5.2 appends a line to the same strict list, so the later of the two pull requests rebases onto the
  other's line; verify with `yarn spec:coverage` reporting nothing for `client-v2-build-server-endpoint`,
  `yarn test-unit src/settings/server/build-server-endpoint.test.ts` passing, and
  `node --test scripts/server-url-gate.test.mjs` passing (ticket to file)

## 6. Closing the change

- [ ] 6.1 In the archive PR, re-point the pointers 1.1 and 2.2 added from the change's delta to
  `openspec/specs/scenario-tests/spec.md`; before deleting `tasks.md`, replace the `[tasks.md](tasks.md)` link in
  design.md, decision 11, with a permalink to `tasks.md` at its last commit (`client-v2/CLAUDE.md`, "Specs and
  changes", step 5); run `yarn spec:tests` so `scenario-tests` gets its `tests.md`; and add `scenario-tests` to
  `client-v2/scripts/spec-coverage-strict.txt`, so the capability that defines the gate passes it; depends on every
  other task; verify with `yarn spec:tests --check`, `yarn spec:validate`, and `yarn spec:coverage` reporting nothing
  for `scenario-tests` beyond its `(manual)` scenarios (ticket to file)
