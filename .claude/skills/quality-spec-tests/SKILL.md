---
name: quality-spec-tests
description: >
  Writes the missing test of each scenario the exclude list names, from the scenario's clauses, removes the
  scenario's line from the list, runs the test and the coverage gate, and reports the result. Never edits product
  code and never commits. Use for /quality-spec-tests, "write the tests for the listed scenarios", "cover
  <capability>", and shrinking `excluded.txt` by writing tests.
argument-hint: "<capability> | <capability>: <scenario> [--opus]"
---

# quality-spec-tests

`<root>` is `git rev-parse --show-toplevel`. `<list>` is
`<root>/.claude/skills/quality-spec-coverage/excluded.txt`. Run commands with absolute paths, `git -C <root>`, or
`yarn --cwd <root>/client-v2`, never `cd`. The rules a test follows are the `scenario-tests` spec
([delta](../../../openspec/changes/scenario-tests/specs/scenario-tests/spec.md)) and `client-v2/AGENTS.md`.

## 1. Resolve the targets

Read `<list>`, without comment lines, blank lines, or trailing spaces.

- An argument holding a colon followed by a space is one key `<capability>: <scenario>`. A key that is not a line of
  `<list>` stops the run with `not on the exclude list: <key>`, and nothing is written.
- Any other argument is a capability: the targets are every line of `<list>` that starts with the capability, a
  colon, and a space. No such line stops the run with `not on the exclude list: <capability>`.

## 2. Start one subagent per scenario

For each target, start one subagent with the Agent tool, with the model and effort the user set for this skill:

| Argument | Model | Effort |
| --- | --- | --- |
| none | `sonnet` | `xhigh` |
| `--opus` | `opus` | `xhigh` |

Pass these values explicitly; they are not the subagent's choice. Subagents for scenarios of different capabilities
may run at the same time; subagents for one capability run one after another, since they may write to one test file.

The subagent's brief, with `<key>`, `<capability>`, and `<scenario>` filled in:

1. Read the scenario `#### Scenario: <scenario>` and its clauses from `<root>/openspec/specs/<capability>/spec.md`,
   with the requirement above it.
2. Read product code only to learn how to drive it: selectors, routes, function names, and fixtures. Take every
   assertion from a THEN clause, or an AND after one, never from what the code does.
3. Pick the level by decision 4 of `<root>/openspec/changes/scenario-tests/design.md`: integration (a vitest file
   `client-v2/vitest.config.ts` collects, or a `node --test` file `yarn test-api` runs) when slices working together
   show the behaviour without a browser; end-to-end (Playwright under `client-v2/e2e/`) when it needs a real browser
   with user clicks, a running validator, a connected wallet, or the real wasm CLIs. Follow `client-v2/AGENTS.md` for
   where the test file goes. Never cite a scenario from an in-source unit block.
4. Title the test with the key, as a string literal: the Playwright `test("<key>")`, or the outer
   `describe("<key>")` of a vitest or `node --test` test. Write each GIVEN and WHEN as a nested `describe` titled
   with the clause, whose hook runs it, and each THEN as an `it` titled with the clause; in Playwright, each clause is
   a `test.step` titled with the clause, or a GIVEN is an enclosing `test.describe` titled with it.
5. Never edit product code, a spec, or another test. Add to an existing test file only the new `describe` or `test`.
6. Run the one test file: `yarn --cwd <root>/client-v2 test-unit <file>` for vitest,
   `node --test <file>` for a `node --test` file, `yarn --cwd <root>/client-v2 test-e2e <file>` for Playwright.
7. Report the test file, the level, pass or fail, and on a failure the failing output. A failing test stays as
   written: do not change it to pass, and do not change the product.

## 3. Remove the lines and run the gate

After each subagent reports, remove the key's line from `<list>` with the Edit tool. Then run
`yarn --cwd <root>/client-v2 spec:coverage` once and keep its output.

## 4. Report

One block per scenario:

```text
<key>
  test: <file> (<level>)
  result: pass | fail
  <failing output, on a fail>
  line removed from excluded.txt
```

Then the summary line of `spec:coverage` and its exit code. A failing test is handed to the developer, who decides
whether the test or the product is wrong. Commit nothing.
