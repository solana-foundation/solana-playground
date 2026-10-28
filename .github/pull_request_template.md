Linear: [HOO-](https://linear.app/solana-fndn/issue/HOO-)

<!-- The issue number goes in both places: [HOO-123](https://linear.app/solana-fndn/issue/HOO-123). Use only this short form; never the long URL with the title after the ID. -->

## TLDR

<!-- One or two sentences: what changes for a user or a contributor. The kind
     of change in the first words: a fix, a move, a new rule, a new capability,
     an OpenSpec task (name it: `ui-migration` 4.2). -->

## Context

<!-- What is true before this PR that the reader needs: the state of the code,
     the ticket's history, the change this task belongs to. -->

## Problem

<!-- What is wrong or missing, in terms of behaviour someone can observe. -->

## Why this way

<!-- The approach chosen and the one or two alternatives rejected, with the
     reason. Link the design.md decision when the task has one. -->

## Evidence

- **Reproduced:** <!-- bug or infrastructure PRs: how the problem was seen
     live (probe, curl, screenshot), with the date. "n/a" for a feature. -->
- **Failed before the fix:** <!-- the test's failing output, or the commit it
     failed at, before the change. "n/a" when the PR adds no fix. -->
- **Screenshots:** <!-- before / after for anything visible. "n/a" otherwise. -->
- **Bundle size:** <!-- from the "Bundle change vs `master`" comment: "no row
     moved", or each row that moved, with its old and new size and why it
     grew. -->

## Checklist

<!-- The rules are in client-v2/CLAUDE.md; tick what applies, delete the rest. -->

- [ ] `check` script green locally ("Before a PR")
- [ ] With the `sx` plugin: `/sx:review-pr full`, then `/sx:review-pr`, run; critical and needed important findings fixed here, the rest in Linear ("Before a PR"). Without it, delete this line
- [ ] Task ticked in `tasks.md`; if it was the last, asked whether to close the change ("Specs and changes" 4-5)
- [ ] Ids, `aria-label`s, test ids unchanged across any move ("What survives every move")
- [ ] One migration, this PR's own ("What review keeps finding")
- [ ] `yarn bundle:info` run and `bench/BUNDLE.md` committed if a row moved; every row that grew explained under Evidence ("Before a PR")

## Not in this PR

<!-- What was deliberately left out, and where it lives (ticket, follow-up). -->
