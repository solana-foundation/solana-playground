# Tasks

This change's proposal lands first as a docs-only PR. After it, 1.1, 2.1, and 2.3 may run at the same time; 2.2
follows 2.1; groups 3 and 4 follow 2.2 and may run at the same time; 5.1 follows 3.1 and 4.1; 5.2 and 5.3 follow
4.2. Each task that
changes `client-v2/scripts/` titles its `node --test` cases with the `scenario-tests` scenarios it
implements, in the clause shape of design.md, decision 1.

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
  `test`, `test.describe`, `test.step`, `describe`, and `it` calls, replacing `TEST_TITLE` in
  `client-v2/scripts/spec-coverage.mjs`; count literal titles only, skip `.skip`, `.fixme`, and `.todo` on `test`,
  `it`, and `describe`, `test.describe.skip` included, and assign each file its level by path (design.md, decisions 3
  and 4);
  verify with `node --test scripts/spec-coverage.test.mjs` covering the scenarios of "Every scenario is a test or is
  marked manual", "A scenario is checked at the integration or the end-to-end level", and "Titles are string literals"
  (ticket to file)
- [ ] 2.2 Read each scenario's clauses (GIVEN included, wrapped lines joined), normalise them and the step titles,
  match them in order for the Playwright shape, and in order and by nesting for the `describe` shape (design.md,
  decision 5), and report per scenario its tests,
  levels, missing clauses, and the candidate duplicates; point the script's docblock at the capability's spec instead
  of the rule's title; depends on 2.1; verify with `node --test scripts/spec-coverage.test.mjs` covering the
  scenarios of the four clause requirements and "The coverage report lists tests, levels, missing clauses, and
  duplicates" (ticket to file)
- [ ] 2.3 Narrow `jest/valid-title`'s disallowed words ("unit", "integration", "e2e") in `client-v2/eslint.config.mjs`
  to `describe` titles that start with neither a clause keyword nor `<capability>: `, so a GIVEN, WHEN, or AND
  `describe` and a scenario `describe` such as `client-v2-unit-tests: <scenario>` may hold them; update the item "A
  test title says what the code does" in `client-v2/CLAUDE.md` to the narrowed rule; the rule warns, so verify with
  `yarn eslint <file>` printing no `jest/valid-title` warning for `describe("WHEN ... integration ...")` and
  `describe("client-v2-unit-tests: ...")`, and printing one for `describe("integration ...")` (ticket to file)

## 3. Generated tests.md

- [ ] 3.1 Add `yarn spec:tests` to write `openspec/specs/<capability>/tests.md` for every capability with a
  `spec.md`, from `openspec/specs/` only, in the format of design.md, decision 7, and to delete a `tests.md` beside no
  `spec.md`; `yarn spec:tests --check` writes nothing and fails naming each stale or missing file and the command;
  commit the generated files and add the `--check` step to the `checks` job of
  `.github/workflows/reusable-client-v2.yml` after "Scenario coverage"; add "run `yarn spec:tests` and commit the
  result" to the archive procedure, in `operations.archive.guidance` of `openspec/config.yaml` and in step 5 of
  "Specs and changes" in `client-v2/CLAUDE.md`, since archiving changes `specs/`; depends on 2.2; verify with
  `node --test scripts/spec-tests.test.mjs` covering the scenarios of "Each capability has a generated tests.md" and
  "CI fails on a stale tests.md", and with `yarn spec:validate` passing over the generated files (ticket to file)

## 4. The strict gate

- [ ] 4.1 Add `client-v2/scripts/spec-coverage-strict.txt` (one capability per line, `#` comments, no capability
  yet) and enforce it on every `yarn spec:coverage` run: an uncovered scenario or a missing clause in a listed
  capability, an assertion clause there whose first word is on the closed list of the spec requirement "An assertion
  clause starts with a verb", or a listed name with no `spec.md`, exits with an error; off the list, the report counts
  such clauses per capability; a scenario only an active change adds is reported; a scenario of a requirement an
  active change modifies is matched by name only; `--strict` keeps failing on any uncovered scenario; replace the
  "Report only" comment above the "Scenario coverage" step of `.github/workflows/reusable-client-v2.yml` with one
  that says the step fails on the strict list; depends on 2.2; verify with
  `node --test scripts/spec-coverage.test.mjs` covering the scenarios of "A listed capability gates its scenarios",
  "An assertion clause starts with a verb", and "An active change does not gate its own scenarios" (ticket to file)
- [ ] 4.2 Add `--base <ref>`, reading the base branch's list with `git show` (a missing file is an empty list), fail
  on a dropped capability whose `spec.md` stays, and pass `--base origin/${{ github.base_ref }}` from the
  "Scenario coverage" step of the `checks` job on `pull_request` runs only; depends on 4.1; verify with
  `node --test scripts/spec-coverage.test.mjs` covering the scenarios of "A pull request cannot drop a strict
  capability" against a temporary git repository (ticket to file)

## 5. Pilots: `client-v2-custom-rpcs` and `client-v2-build-server-endpoint`

- [ ] 5.1 Rewrite every THEN clause, and every AND after a THEN, in `openspec/specs/client-v2-custom-rpcs/spec.md`
  to start with a verb, without changing what it asserts; give each of its 20 tested scenarios' tests a `test.step`
  per clause, titled with the rewritten clauses (all 20 are end-to-end, in
  `client-v2/e2e/client-v2-custom-rpcs.e2e.spec.ts`; no vitest file cites the capability), keeping the test titles;
  and regenerate `openspec/specs/client-v2-custom-rpcs/tests.md`; depends on 3.1 and 4.1; verify with
  `yarn spec:coverage` reporting no uncovered scenario, no missing clause, and no listed first word for
  `client-v2-custom-rpcs`, and with `yarn test-e2e e2e/client-v2-custom-rpcs.e2e.spec.ts` passing (ticket to file)
- [ ] 5.2 Add `client-v2-custom-rpcs` to `client-v2/scripts/spec-coverage-strict.txt`; depends on 4.2 and 5.1;
  verify that the `checks` job passes, and that renaming one `client-v2-custom-rpcs` step locally makes
  `yarn spec:coverage` exit with an error (ticket to file)
- [ ] 5.3 Pilot the vitest form on `client-v2-build-server-endpoint`, whose 6 scenarios are all `(manual)`:
  rewrite every THEN clause, and every AND after a THEN, in `openspec/specs/client-v2-build-server-endpoint/spec.md`
  to start with a verb; write each scenario a test can check at the integration level in
  `src/settings/server/build-server-endpoint.test.ts`, as `describe(<scenario>) > describe("GIVEN ...")` /
  `describe("WHEN ...") > it("THEN ...")` / `it("AND ...")` (design.md, decision 1), and drop its `(manual)` mark;
  expected candidates are "A fresh checkout", "The variable is set", and "A stored choice without the variable",
  which `src/settings/server/default-endpoint.ts`, `src/settings/server/server.test.ts`, and
  `src/settings/stored-endpoint.ts` already cite in comments; "The sources are searched" (a search of the tracked
  tree), "A preview build without the variable", and "A CI build" (build-time checks of `scripts/server-url-gate.mjs`
  under `VERCEL_ENV`) are expected to stay `(manual)`, and the implementer makes the final call, noting that a
  `node --test` case in `scripts/server-url-gate.test.mjs` also counts as integration (design.md, decision 4); remove
  the scenario comments from the in-source blocks of `default-endpoint.ts` and `stored-endpoint.ts`, which are unit
  level and cite no scenario, keeping their tests, and the comment in `server.test.ts` once the new file checks that
  scenario; add `client-v2-build-server-endpoint` to `client-v2/scripts/spec-coverage-strict.txt` and regenerate
  `openspec/specs/client-v2-build-server-endpoint/tests.md`; depends on 2.2, 3.1, 4.1, and 4.2, and may run beside
  5.1 and 5.2; verify with `yarn spec:coverage` reporting nothing for `client-v2-build-server-endpoint` and
  `yarn test-unit src/settings/server/build-server-endpoint.test.ts` passing (ticket to file)

## 6. Closing the change

- [ ] 6.1 In the archive PR, re-point the pointers 1.1 and 2.2 added from the change's delta to
  `openspec/specs/scenario-tests/spec.md`; before deleting `tasks.md`, replace the `[tasks.md](tasks.md)` link in
  design.md, decision 11, with a permalink to `tasks.md` at its last commit (`client-v2/CLAUDE.md`, "Specs and
  changes", step 5); run `yarn spec:tests` so the new capability gets its `tests.md`; and add `scenario-tests` to
  `client-v2/scripts/spec-coverage-strict.txt`, so the capability that defines the gate passes it; depends on every
  other task; verify with `yarn spec:tests --check`, `yarn spec:validate`, and `yarn spec:coverage` reporting nothing
  for `scenario-tests` beyond its one manual scenario (ticket to file)
