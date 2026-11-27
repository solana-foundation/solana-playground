# Tasks

This change's proposal lands first as a docs-only PR. After it, 1.1, 2.1, and group 4 may run at the same time; 2.3
follows 1.1, because both rewrite the item "A test title says what the code does" in `client-v2/CLAUDE.md`; 2.2
follows 2.1 and 4.1; group 3 follows 2.2; 5.1 follows 2.2 and 3.1; 5.2 follows 5.1; 5.3 follows 2.2 and 3.1. Each
task that changes the checker titles its `node --test` cases with the `scenario-tests` scenarios it implements, in
the clause shape of design.md, decision 1. The checker is
`.claude/skills/quality-spec-coverage/scripts/spec-coverage.mjs`, and `<checker test>` below stands for
`.claude/skills/quality-spec-coverage/scripts/spec-coverage.test.mjs`.

## 1. The rule moves to the spec

- [ ] 1.1 Replace the "Scenarios are the test plan" paragraph in `client-v2/CLAUDE.md` with a pointer to
  `openspec/changes/scenario-tests/specs/scenario-tests/spec.md`, make the "A test title says what
  the code does" rule cite the spec instead of the paragraph's title, and add a `rules.specs` line to
  `openspec/config.yaml`, after the `**Area:**` rule: a scenario's clauses are GIVEN (optional), WHEN, THEN, and AND,
  each becoming a titled test step, and every THEN and every AND after a THEN starts with a verb after its keyword;
  reword the header comment of `openspec/config.yaml`, which says the rules live in `client-v2/CLAUDE.md` and are not
  repeated, since `rules.specs` holds spec-writing rules of its own; verify with `yarn spec:validate` and with
  `openspec instructions specs --change <any active change> --json` listing the new rule (ticket to file)

## 2. The checker

- [ ] 2.1 Parse `e2e/`, the vitest files the `include` globs of `client-v2/vitest.config.ts` collect (read from the
  config, not copied), and the `*.test.mjs` files `yarn test-api` runs with `ts.createSourceFile` into a tree of titled
  `test`, `test.describe`, `test.step`, `describe`, and `it` calls, replacing the title regular expression of the
  checker; count literal titles only; skip an unconditional skip (`.skip`, `.fixme`,
  and `.todo` on `test`, `it`, and `describe`, `test.describe.skip` and `test.describe.fixme` included, an in-body
  `test.skip()` or `test.fixme()` with no condition, and a `node:test` `skip` or `todo` option that is `true` or a
  string) and count a conditional one; report a `(manual)` scenario a test cites as a conflict that fails the run,
  and resolve each conflict the first run finds in the same PR; and assign each file its level by path (design.md,
  decisions 3, 4, and 6); verify with `node --test <checker test>` covering the scenarios of "Every scenario is a
  test or is marked manual", "A scenario is checked at the integration or the end-to-end level", and "Titles are
  string literals" (ticket to file)
- [ ] 2.2 Read each scenario's clauses (GIVEN included, wrapped lines joined), normalise them and the step titles,
  match them in order for the Playwright shape, and in order and by nesting for the `describe` shape (design.md,
  decision 5), count a flat `it` or `test` titled with a scenario as citing it with every clause missing (decision
  1), and report per scenario its tests,
  levels, missing clauses, and the candidate duplicates; raise the exclude list's standard to every clause a step and
  every assertion clause starting with a verb, failing on a word of the closed list of the spec requirement "An
  assertion clause starts with a verb" for a scenario not on the list and counting such clauses per capability for a
  listed one, and regenerate `excluded.txt` with `make quality-spec-coverage-update`, so the scenarios that fall short
  return to it (design.md, decision 8, and Risks); point the checker's docblock at the capability's spec instead of
  the rule's title; depends on 2.1 and 4.1; verify with `node --test <checker test>` covering the scenarios of the
  four clause requirements, "An assertion clause starts with a verb", and "The coverage report lists tests, levels,
  missing clauses, and duplicates" (ticket to file)
- [ ] 2.3 Narrow `jest/valid-title`'s disallowed words ("unit", "integration", "e2e") in `client-v2/eslint.config.mjs`
  to `describe` titles that start with neither a clause keyword nor `<capability>: `, so a GIVEN, WHEN, or AND
  `describe` and a scenario `describe` such as `client-v2-unit-tests: <scenario>` may hold them; update the item "A
  test title says what the code does" in `client-v2/CLAUDE.md` to the narrowed rule; depends on 1.1, which rewrites
  the same item; the rule warns, so verify with
  `yarn eslint <file>` printing no `jest/valid-title` warning for `describe("WHEN ... integration ...")` and
  `describe("client-v2-unit-tests: ...")`, and printing one for `describe("integration ...")` (ticket to file)

## 3. Generated tests.md

- [ ] 3.1 Add `yarn spec:tests` to write `openspec/specs/<capability>/tests.md` for every capability with a
  `spec.md`, from `openspec/specs/` only, in the format of design.md, decision 7, a `missing` row for a clause the
  test has no step for included, and to delete a `tests.md` beside no `spec.md`; `yarn spec:tests --check` writes
  nothing and fails naming each stale or missing file and the command; commit the generated files, add the `--check` step to
  the `checks` job of `.github/workflows/reusable-client-v2.yml` after "Scenario coverage", and add
  `yarn spec:tests --check` to the `check` script of `client-v2/package.json` after `yarn spec:coverage`, so
  `yarn run check` runs what the job runs; add "run `yarn spec:tests` and commit the
  result" to the archive procedure, in `operations.archive.guidance` of `openspec/config.yaml` and in step 5 of
  "Specs and changes" in `client-v2/CLAUDE.md`, since archiving changes `specs/`; depends on 2.2; verify with
  `node --test scripts/spec-tests.test.mjs` covering the scenarios of "Each capability has a generated tests.md" and
  "CI fails on a stale tests.md", and with `yarn spec:validate` passing over the generated files (ticket to file)

## 4. The exclude list gate

- [x] 4.1 Move the checker and its test to `.claude/skills/quality-spec-coverage/scripts/`, read literal titles of
  `test`, `describe`, and `it` from `e2e/`, the vitest files, and the `node --test` files, and gate every scenario of
  `openspec/specs/` on the exclude list `.claude/skills/quality-spec-coverage/excluded.txt` (one
  `<capability>: <scenario>` per line, `#` comments), generated by `--update-excluded`: an unmatched scenario not on
  the list, a listed scenario that has a test, a listed name that is no scenario or is `(manual)`, and a duplicate
  line exit with an error; a scenario only an active change adds is reported; `--strict` ignores the list; add
  `Makefile.quality` and the `quality-spec-coverage` skill; replace the "Report only" comment above the "Scenario
  coverage" step of `.github/workflows/reusable-client-v2.yml`; rewrite "Scenarios are the test plan" in
  `client-v2/CLAUDE.md` for the list (Tasks 2, 3, 5, and 6 of
  [the plan](plans/4.1-exclude-list.md)); verify with `node --test <checker test>` covering the scenarios of "The
  exclude list gates every scenario" and "An active change does not gate its own scenarios", and
  `yarn spec:coverage` exiting 0
- [x] 4.2 Add `--base <ref>`, reading the base branch's list with `git show` (a base branch without the file skips the
  comparison), fail on a line the base branch's list lacks, and on `pull_request` runs fetch the base branch and pass
  `--base FETCH_HEAD` from the "Scenario coverage" step of the `checks` job (Task 4 of
  [the plan](plans/4.1-exclude-list.md)); verify with `node --test <checker test>` covering the scenarios of "The
  exclude list only shrinks" against a temporary git repository
- [x] 4.3 Add the `quality-spec-tests` skill, which writes the test of a listed scenario from its clauses through a
  subagent, removes the scenario's line, runs the test and `yarn spec:coverage`, and reports a failing test to the
  developer without changing product code (Task 7 of [the plan](plans/4.1-exclude-list.md)); verify with a dry run on
  one listed scenario covering the manual scenarios of "A skill writes the test of a listed scenario"

## 5. Pilots: `client-v2-custom-rpcs` and `client-v2-build-server-endpoint`

- [ ] 5.1 Rewrite every THEN clause, and every AND after a THEN, in `openspec/specs/client-v2-custom-rpcs/spec.md`
  to start with a verb, without changing what it asserts; give each of its 20 tested scenarios' tests a `test.step`
  per clause, titled with the rewritten clauses (all 20 are end-to-end, in
  `client-v2/e2e/client-v2-custom-rpcs.e2e.spec.ts`; no vitest file cites the capability), keeping the test titles;
  and regenerate `openspec/specs/client-v2-custom-rpcs/tests.md`; depends on 2.2 and 3.1; verify with
  `yarn spec:coverage` reporting no uncovered scenario, no missing clause, and no listed first word for
  `client-v2-custom-rpcs`, and with `yarn test-e2e e2e/client-v2-custom-rpcs.e2e.spec.ts` passing (ticket to file)
- [ ] 5.2 Remove the `client-v2-custom-rpcs` lines from `.claude/skills/quality-spec-coverage/excluded.txt`; depends
  on 5.1; verify that the `checks` job passes, and that renaming one `client-v2-custom-rpcs` step locally makes
  `yarn spec:coverage` exit with an error (ticket to file)
- [ ] 5.3 Pilot the vitest and node forms on `client-v2-build-server-endpoint`, whose 6 scenarios are all
  `(manual)`: rewrite every THEN clause, and every AND after a THEN, in
  `openspec/specs/client-v2-build-server-endpoint/spec.md` to start with a verb, without changing what it asserts;
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
  level and cite no scenario, keeping their tests, and the comment in `server.test.ts` once the new file checks that
  scenario; remove any `client-v2-build-server-endpoint` lines from `.claude/skills/quality-spec-coverage/excluded.txt`
  and regenerate `openspec/specs/client-v2-build-server-endpoint/tests.md`; depends on 2.2 and 3.1, and may run
  beside 5.1 and 5.2; verify with `yarn spec:coverage` reporting nothing for `client-v2-build-server-endpoint`,
  `yarn test-unit src/settings/server/build-server-endpoint.test.ts` passing, and
  `node --test scripts/server-url-gate.test.mjs` passing (ticket to file)

## 6. Closing the change

- [ ] 6.1 In the archive PR, re-point the pointers 1.1 and 2.2 added from the change's delta to
  `openspec/specs/scenario-tests/spec.md`; before deleting `tasks.md`, replace the `[tasks.md](tasks.md)` link in
  design.md, decision 11, with a permalink to `tasks.md` at its last commit (`client-v2/CLAUDE.md`, "Specs and
  changes", step 5); run `yarn spec:tests` so the new capability gets its `tests.md`; and leave
  `.claude/skills/quality-spec-coverage/excluded.txt` without a `scenario-tests` line, so the capability that defines
  the gate passes it with every scenario tested or manual; depends on every other task; verify with `yarn spec:tests --check`,
  `yarn spec:validate`, and `yarn spec:coverage` reporting nothing for `scenario-tests` beyond its manual scenarios
  (ticket to file)
