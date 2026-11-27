---
name: quality-spec-coverage
description: >
  Runs the scenario coverage gate, which fails on a spec scenario with no test, no `(manual)` mark, and no line in
  the exclude list, and explains each group of its report and the fix. Use for /quality-spec-coverage, a red
  "Scenario coverage" step in CI, "which scenarios lack tests", "why does spec:coverage fail", and shrinking the
  exclude list.
argument-hint: "[--base <ref> | --strict]"
---

# quality-spec-coverage

The gate reads every `#### Scenario:` of `openspec/specs/` and the active changes, and the literal titles of the
tests in `client-v2/e2e/`, the vitest files `client-v2/vitest.config.ts` collects, and the `*.test.mjs` files
`yarn test-api` runs. A scenario is covered by a test titled `<capability>: <scenario>`: a Playwright `test`, or the
outer `describe` of a vitest or `node --test` test. The rules are the `scenario-tests` spec
([delta](../../../openspec/changes/scenario-tests/specs/scenario-tests/spec.md)).

`<root>` is `git rev-parse --show-toplevel`. Run commands from `<root>` with absolute paths, never `cd`.

## Run

```sh
make quality-spec-coverage                          # what `yarn run check` and CI's push runs run
make quality-spec-coverage ARGS="--base <ref>"      # what CI's pull request runs run, against the fetched base
make quality-spec-coverage ARGS=--strict            # ignore the exclude list: every uncovered scenario fails
```

## Read the report

Each group prints only when it has entries. Every group except the last fails the run.

| Group | Fix |
| --- | --- |
| Lines in excluded.txt that `<ref>`'s list lacks | Remove the line, and give the scenario a test or the `(manual)` mark |
| Scenarios with no test, no (manual) mark, and no line in excluded.txt | Add a test titled with the key, or the `(manual)` mark in the spec |
| Lines in excluded.txt whose scenario now has a test | Remove the line |
| Lines in excluded.txt that name no scenario of openspec/specs/, or a (manual) one | Remove the line |
| Lines in excluded.txt that appear more than once | Remove the copies |
| Scenarios only an active change adds, with no test | None needed: reported until the change is archived |

The last line counts the scenarios: tested, manual, and on the exclude list.

## The exclude list

[`excluded.txt`](excluded.txt) names the scenarios of `openspec/specs/` that are not yet up to standard, one
`<capability>: <scenario>` per line; `#` starts a comment line. On a pull request, a line the base branch's list
lacks fails the run, so the list only shrinks. A new scenario needs a test or the `(manual)` mark in the PR that adds
it, never a line here.

`make quality-spec-coverage-update` rewrites the list from the scenarios that have no test. Run it on a branch whose
tests caught up, so it only removes lines; a line it adds fails the base comparison on the pull request.

To write the missing tests and remove their lines, run `/quality-spec-tests <capability>` or
`/quality-spec-tests <capability>: <scenario>`.
