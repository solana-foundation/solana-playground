---
name: babysit
description: >
  Keeps the open PR of the current branch mergeable: every CI check passes, Greptile is at 5/5 with no unresolved
  thread, and every item under the body's `## Checklist` is ticked with evidence or struck as not applicable. One
  pass per run; `/loop /babysit` repeats passes until all three hold. Use for /babysit, "babysit the PR", "watch
  the PR until it is green", "keep the checklist true", "tick the PR checklist", "CI is red on my PR, fix it",
  and after every push, greploop run, or CI result on an open PR. Not for a merge-readiness code review, which
  is /sx:review-pr.
argument-hint: "[pr-number]"
---

# Babysit

A PR is done when all three hold:

- Every check of `gh pr checks` is in bucket `pass` or `skipping`.
- Greptile's latest score is 5/5 and no review thread is unresolved. Greptile reviews only PRs into `master` on
  the foundation repository (`greptile.json`); for any other PR this condition holds by default.
- No `- [ ]` item is left under `## Checklist` in the PR body.

## The PR template

The PR body is [`.github/pull_request_template.md`](../../../.github/pull_request_template.md) filled in by the
author. The skill works from that body and never from a structure of its own:

- The checklist is the template's `## Checklist`, item for item; the table in "5. Walk the checklist" says how
  to mark it. Where the template's comment says to delete an item that does not apply, strike it instead: a
  struck item shows the reviewer it was considered, a deleted one does not.
- The filled sections are the author's statement of the PR's scope. Judge each item against them: what
  `## TLDR` and `## Blast radius` say the PR changes, what `## Not in this PR` says it leaves out, and what
  `## Evidence` already names.
- A section the author filled stays as written. The skill edits only checklist states and the `## Evidence`
  slot an item points at. A filled section that the head no longer matches (a bundle row that moved, a file
  added outside the stated blast radius) is reported, not rewritten.
- A body that does not follow the template (a section missing or renamed) is reported and the pass stops:
  ticking items against a different structure would hide the gap.

## 1. Find the PR

Run in the branch the PR is open from. With an argument, use that PR number.

```sh
gh pr view --json number,url,headRefName,headRefOid,baseRefName,body
```

PRs open on `solana-foundation/solana-playground` from `hoodieshq:<branch>`. When `gh pr view` finds none, run
`gh pr list --repo solana-foundation/solana-playground --head <branch> --json number,url` and pass
`--repo solana-foundation/solana-playground` to every later `gh pr` call. No PR at all: stop and say so.

The local head must equal `headRefOid`. A different head means unpushed commits or a stale checkout: report
it and stop, since the checks would describe other code.

## 2. Sync the body file

The body lives in an untracked `.github/*.pr.md` file; never `git add` it. File names do not always follow the
branch (`tutorial-flow-2.pr.md`), so find the file whose `## TLDR` matches the remote body's before creating one.

- No such file: write the remote body into `.github/<slug>.pr.md`, where `<slug>` is the branch name with `/`
  replaced by `-`.
- File differs from the remote body: someone edited the PR on GitHub. Take the remote body, keep the local
  file's checklist edits only where the remote left those lines unchanged, and name each conflict in the report.

## 3. Checks

```sh
gh pr checks <n> --json name,workflow,bucket,state,link
```

- `pending`: in loop mode, end the pass and let the wakeup in step 7 return. Outside loop mode, run
  `gh pr checks <n> --watch --fail-fast` with `run_in_background` and continue this pass when it exits.
- `fail` or `cancel`: read the log (`gh run view <run-id> --log-failed`; the run id is in `link`). A check
  outside GitHub Actions (Vercel, CodeQL, Greptile) has no run: open its `link` or `description` instead.
  Find the cause before touching code. A flake (network, runner, timeout with no code path involved) gets
  `gh run rerun <run-id> --failed` once; a second failure of the same job is not a flake.
- A real failure: fix it locally, run the local command that matches the failing job (the `client-v2/` scripts
  in the root `CLAUDE.md`), then **ask before each commit and push**. The commit message is one
  conventional-commit line with no trailer. Never force-push without `--force-with-lease`.

## 4. Greptile

Read the score and the unresolved threads as `/greploop` steps B and F do, trusting only its bot logins. When
the score is below 5/5 or a thread is unresolved, run `/greploop` on the PR. It runs before the checklist
walk, because its fixes move the head and invalidate evidence.

`/greploop` commits and pushes on its own. Under `/babysit`, its commit-and-push step follows the same rule as a
CI fix: show the diff and ask first. Its `@greptile review` comment, thread replies, and thread resolutions run
without asking.

## 5. Walk the checklist

Read the filled template sections and the changed files first: `gh pr diff <n> --name-only`. GitHub computes
that list against the PR's real base; a local `git diff` against `origin` would use hoodieshq's `master`, not
the foundation's. An item is not applicable only when both agree: the diff does not touch
what the item governs, and no filled section claims it does.

Each item under `## Checklist` ends in exactly one of three states. Never reword, reorder, add, or delete an item.

| State | Form | When |
| --- | --- | --- |
| Done | `- [x] Item` | Evidence exists for this head commit. Name it under `## Evidence` when the template has a slot for it. |
| Not applicable | `- ~~[ ] Item~~` | The diff does not touch what the item governs: no file under `db/migrations` for the migration item, no moved component for the ids item. No reason appended. |
| Open | `- [ ] Item` | The work is running or not done. The report says what is left. |

An item's quoted section name, such as "Before a PR", points at that section of `client-v2/CLAUDE.md`, which
defines what counts as done. Evidence is a local command run on this head, a passing CI job that runs the same
command, or a report file. A CI step that stands in for a local one counts: the "Bundle change report" in the
`client-v2 / build` log is evidence for the bundle item when no bundle comment is posted.

A push after an item was ticked invalidates evidence that depended on the old head. Re-check those items.

## 6. Apply the body

When the local file changed in this pass, apply it:

```sh
gh pr edit <n> --body-file .github/<slug>.pr.md
```

Invoking `/babysit` authorises this command and the `/greploop` GitHub writes named in step 4. Every commit and
push still needs a yes.

## 7. Report and continue

Report in a few lines:

```text
PR #<n> at <short-sha>
  Checks:    <pass>/<total> pass, <pending> pending, <failed> failed (<names>)
  Greptile:  <score>/5, <unresolved> unresolved | not reviewed (base is not foundation master)
  Checklist: <ticked> ticked, <struck> struck, <open> open
  Open:      <item>: <what is left>
  Body:      applied | unchanged
```

Then, in loop mode (`/loop /babysit`):

- Done (all three conditions at the top hold): stop the loop with `ScheduleWakeup` `stop: true`.
- Blocked on the user (a push to approve, an item only the user can do): stop the loop and say what is needed.
- Checks pending: schedule the next pass with `noop: true` when nothing changed. Pick the delay from the
  longest pending job, not a fixed short interval.
