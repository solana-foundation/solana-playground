---
name: babysit
description: >
  Watches the open PR of the current branch until nothing but a human review blocks the merge: no merge
  conflict, CI green as `client-v2/CLAUDE.md` "Before a PR" defines it, Greptile at 5/5 with no unresolved thread, and every item under
  the body's `## Checklist` ticked with evidence or struck as not applicable. Fixes CI failures and Greptile
  findings with the user's approval for each commit and push; reports a conflict and stops. Covers PRs on
  solana-foundation/solana-playground and feature PRs on hoodieshq/solana-playground. One pass per run;
  `/loop /babysit` repeats passes until all four hold. Use for /babysit, "babysit the PR", "watch the PR until it
  is green", "keep the checklist true", "tick the PR checklist", "CI is red on my PR, fix it", and after every
  push, greploop run, or CI result on an open PR. Not for a merge-readiness code review, which is /sx:review-pr.
argument-hint: "[pr-number | owner/repo#pr-number]"
---

# Babysit

A PR is done when all four hold:

- GitHub reports no merge conflict and nothing but a missing review blocks the merge: `mergeable` is
  `MERGEABLE`, `isDraft` is false, `reviewDecision` is not `CHANGES_REQUESTED`, and `mergeStateStatus` is
  `CLEAN`, `UNSTABLE`, or `HAS_HOOKS`, or `BLOCKED` with `reviewDecision` of `REVIEW_REQUIRED`. Check results
  are the second condition's. No `pull_request` workflow runs while a conflict exists, so green checks on a
  conflicted head say nothing about the merge.
- CI is green on the head commit, as the green rule in `client-v2/CLAUDE.md` "Before a PR" defines it. An empty
  check list is pending, not green.
- Greptile's score for the head commit is 5/5 and no review thread is unresolved. Greptile reviews only PRs into
  `master` (`greptile.json`) on the foundation repository (root `CLAUDE.md`, "This is a fork"); for any other PR
  this condition holds by default.
- No `- [ ]` item is left under `## Checklist` in the PR body on GitHub, not the local file.

A failing or skipped `Vercel` check does not count against the second condition: "Before a PR" says a red or
skipped Vercel preview does not hold the merge. The report lists the check as expected, never as a failure to fix.

## The PR template

The PR body is [`.github/pull_request_template.md`](../../../.github/pull_request_template.md) filled in by the
author. The skill works from that body and never from a structure of its own:

- The checklist is the template's `## Checklist`, item for item; the table in "5. Walk the checklist" says how
  to mark it. Where the template's comment says to delete an item that does not apply, strike it instead: a
  struck item shows the reviewer it was considered, a deleted one does not.
- The filled sections are the author's statement of the PR's scope. Judge each item against them: what
  `## TLDR` and `## Blast radius` say the PR changes, what `## Not in this PR` says it leaves out, and what
  `## Evidence` already names.
- A section the author filled stays as written. The skill edits only checklist states and the lines it adds
  under `## Evidence`. A filled section that the head no longer matches (a bundle row that moved, a file
  added outside the stated blast radius) is reported, not rewritten.
- A body that does not follow the template (a section missing or renamed) is reported and the pass stops:
  ticking items against a different structure would hide the gap.

## Repository

PRs into `master` open on `solana-foundation/solana-playground` from `hoodieshq:<branch>`. Feature PRs into
`scope/<stage>` open on `hoodieshq/solana-playground` (root `CLAUDE.md`, "This is a fork"). `<repo>` is the
repository step 1 finds the PR on, or the one the argument names as `owner/repo#<n>`.

Every GitHub command names `<repo>` explicitly: `--repo <repo>` on `gh pr` and `gh run`, `repos/<repo>/...` in
`gh api`, and the same in each command `/greploop` runs. The local `gh` default and the `origin` remote point at
hoodieshq, so an implicit command reads the wrong repository for a foundation PR.

## Commits

Every commit this skill makes, for a CI fix or a Greptile fix, follows one rule:

- Stage only the paths the fix changed, by name: `git add -- <path>...`. Never `git add -A` or `git add .`: the
  checkout holds untracked files that must not reach the PR.
- Show `git diff --cached`, then ask before the commit and again before the push.
- The message is one conventional-commit line with no trailer.
- Never force-push without `--force-with-lease`.

## 1. Find the PR

Run in the branch the PR is open from. With `owner/repo#<n>`, use that PR. Otherwise look on the foundation
repository first, then on hoodieshq. With a bare number, run
`gh pr view <n> --repo <repo> --json number,state,headRefName,headRepositoryOwner` on each; "Could not resolve
to a PullRequest" is no match on that repository. Without an argument:

```sh
gh pr list --repo <repo> --head <branch> --state open --json number,state,headRefName,headRepositoryOwner
```

On both paths, a match is an open PR whose `headRepositoryOwner.login` is `hoodieshq` and whose `headRefName` is
the current branch: `--head` matches the branch name in any fork. More than one match, on one repository or on
both: report them and stop. No match on either: stop and say so. Any other `gh` error (an expired login) is
reported as an error, never as "no open PR".

```sh
gh pr view <n> --repo <repo> --json number,url,headRefName,headRefOid,baseRefName,mergeable,isDraft,mergeStateStatus,reviewDecision,changedFiles,body
```

The local head must equal `headRefOid`. A different head means unpushed commits or a stale checkout: report
it and stop, since the checks would describe other code. When the local head is the commit this skill pushed
last, the mismatch is pending: GitHub has not read the push yet.

- `mergeable` of `CONFLICTING`: report it and stop.
- `isDraft` true: report that the draft blocks the merge, and walk the other conditions.
- `mergeStateStatus` of `BEHIND`: the branch needs a rebase onto its base, never a merge ("Before a PR"; a branch
  stacked on a squash-merged PR uses the `--onto` form described there). With a clean tracked tree
  (`git status --porcelain --untracked-files=no` prints nothing), fetch `<baseRefName>` from the remote of
  `<repo>`, not `origin` for a foundation PR, and ask before the rebase. On a conflict, run
  `git rebase --abort` and stop. After the rebase, the push follows "Commits".
- `mergeable` or `mergeStateStatus` of `UNKNOWN`: GitHub is still computing it; treat it as pending.
- `mergeStateStatus` of `BLOCKED`: with `reviewDecision` of `REVIEW_REQUIRED`, the report says a review is
  missing. With `APPROVED` or an empty value, a required check holds the merge, and step 3 handles it. With
  `CHANGES_REQUESTED`, it is blocked on the user.

## 2. Sync the body file

The body lives in an untracked `.github/*.pr.md` file; never `git add` it. Look for `.github/<slug>.pr.md` first,
where `<slug>` is the branch name with `/` replaced by `-`, then for a file whose `## TLDR` matches the remote
body's.

- File matches the remote body: continue.
- File differs from the remote body: the pass cannot tell a local edit from a remote one. Report each section
  that differs and stop; the user picks the version.
- No such file, and no other `.github/*.pr.md` exists: write the remote body into `.github/<slug>.pr.md` and say
  in the report that it was created.
- No such file, but other `.github/*.pr.md` files exist: list them and stop; the user names the file.

The file chosen here is `<body-file>` for the rest of the pass.

## 3. Checks

```sh
gh pr checks <n> --repo <repo> --json name,workflow,bucket,state,link,description,startedAt
```

With `--json`, the state comes from `bucket` only: the command exits 0 even with a red check. Exit 1 with
"no checks reported" means no check has started on the head: treat it as pending. Any other non-zero exit is a
`gh` error: report it and stop the pass.

The skipping, fail, and flake bullets apply to checks of the `Upstream: checks` (`ci.yml`) and `Client v2`
(`client-v2.yml`) workflows; the report lists other checks (`Preview`, CodeQL) as information.

- A check still without `startedAt` an hour after its run's `createdAt` is stuck in the queue: report it as
  blocked on the user. The run's `createdAt` comes from `gh run view <run-id> --repo <repo> --json createdAt`.
- No check yet from one of the two workflows: read
  `gh run list --repo <repo> --commit <headRefOid> --json workflowName,status,conclusion,createdAt`. A run in
  `action_required` or `startup_failure` is blocked on the user. A workflow with no run an hour after the first
  run on the head was created is blocked on the user. Otherwise it is pending.
- `pending`: in loop mode, end the pass and let the wakeup in step 7 return. Outside loop mode, run
  `gh pr checks <n> --repo <repo> --watch` with `run_in_background`. When it exits, run the `--json` command
  again and continue from its result. With no check to watch, end the pass as pending.
- `skipping`: the report names every skipped check other than `checks / Build` and `Vercel`.
- `fail` or `cancel`: read the log (`gh run view <run-id> --repo <repo> --log-failed`; the run id is in `link`). A
  check outside GitHub Actions (Vercel, CodeQL, Greptile) has no run: read its `description` or open its `link`
  instead. A cancelled run has no failed-step log: read `gh run view <run-id> --repo <repo> --json jobs` for the
  job that stopped. Find the cause before touching code.
- A flake (network, runner, timeout with no code path involved) gets
  `gh run rerun <run-id> --repo <repo> --failed` only when `gh run view <run-id> --repo <repo> --json attempt`
  reports attempt 1. A failure on a later attempt is not a flake. A failed rerun is reported; after a successful
  one, end the pass as pending.
- A real failure: fix it locally, run the failing step's command from its workflow file, then commit and push as
  "Commits" says.

A push in this pass, from a CI fix, a rebase, or `/greploop`, makes every result read so far describe the old
head. After it, go back to step 1 and read everything again: the head, `mergeable`, and the checks of the new head.

## 4. Greptile

Skip this step unless the PR's base is `master` on the foundation repository.

Read the score and the unresolved threads as `/greploop` steps B and F do, trusting only its bot logins. A score
counts only when the commit link in its "Last reviewed commit" footer ends in `headRefOid`; the link text is the
commit title. No review of the head is pending, not a low score: Greptile reviews every push on its own, so wait
for that review instead of running `/greploop`, whose step A would post a second trigger.

When the score of the head is below 5/5 or a thread is unresolved, run `/greploop` on the PR, before the
checklist walk, because its fixes move the head and invalidate evidence. Under `/babysit`, `/greploop` runs one
iteration, steps A to F, with these overrides:

- Step E follows "Commits" instead of its own commands.
- Step A's push and step F's replies run only after the user approved the push.
- Replies and resolutions run without asking only on threads whose first comment is by a Greptile bot login.
  An unresolved thread started by a person is blocked on the user.
- A timeout, the iteration cap, or a score below 5/5 with nothing actionable left is blocked on the user; the
  report lists the remaining items.

When it pushed, restart from step 1 as step 3 says.

## 5. Walk the checklist

Read the filled template sections and the changed files first:

```sh
gh api repos/<repo>/pulls/<n>/files --paginate --jq '.[].filename'
```

GitHub computes that list against the PR's real base. A local `git diff` against `origin` would use hoodieshq's
`master`, not the foundation's. When the command fails, or the number of files differs from `changedFiles`
(the endpoint stops at 3000 files), report it and stop the pass: a short list would make items look not
applicable.

Each item under `## Checklist` ends in exactly one of three states. Never reword, reorder, add, or delete an item.

| State | Form | When |
| --- | --- | --- |
| Done | `- [x] Item` | Evidence exists for this head commit. |
| Not applicable | `- ~~[ ] Item~~` | The diff does not touch what the item governs (no file under `db/migrations` for the migration item, no moved component for the ids item), and no filled section claims it does. No reason appended. |
| Open | `- [ ] Item` | The work is running or not done. The report says what is left. |

An item's quoted section name, such as "Before a PR", points at that section of `client-v2/CLAUDE.md`, which
defines what counts as done. Evidence is a local command run on this head, a passing CI job that runs the same
command, or a report file. A CI step that stands in for a local one counts: the "Bundle change report" in the
`client-v2 / build` log is evidence for the bundle item when no bundle comment is posted.

A local command counts only from a clean tracked tree: `git status --porcelain --untracked-files=no` prints
nothing. For each item the skill ticks, it adds one line under `## Evidence` naming the evidence and the head SHA
it ran at. Every pass re-verifies those ticks against `headRefOid`; one whose line names an older SHA is open
again. A tick the author set stands unless its own evidence line names an older SHA. The `check` script item
needs a local run, recorded the same way.

## 6. Apply the body

When the local file changed in this pass, read the remote body again. When it differs from the body step 1 read,
someone edited the PR during the pass: report it and stop without writing. Otherwise apply the file:

```sh
gh pr edit <n> --repo <repo> --body-file <body-file>
```

A non-zero exit is reported as "Body: edit failed", never as applied.

Invoking `/babysit` authorises this command, `gh run rerun --failed` on a first attempt (step 3), and the
`/greploop` comment, replies, and resolutions step 4 allows. Every rebase, commit, and push still needs a yes.

## 7. Report and continue

Report in a few lines:

```text
PR #<n> on <repo> at <short-sha>
  Merge:     mergeable | conflicting | draft | behind | review required | changes requested | blocked | unknown
  Checks:    <pass>/<total> pass, <pending> pending, <failed> failed (<names>), skipped (<names>); expected: Vercel <state>
  Greptile:  <score>/5, <unresolved> unresolved | pending (no review of <short-sha>) | not reviewed (base is not foundation master)
  Checklist: <ticked> ticked, <struck> struck, <open> open
  Open:      <item>: <what is left>
  Body:      applied | unchanged | created | edit failed
```

Then, in loop mode (`/loop /babysit`):

- Done (all four conditions in "Babysit" hold): stop the loop with `ScheduleWakeup` `stop: true`.
- Blocked on the user (a merge conflict, a draft, requested changes, a rebase or push to approve, a body
  conflict, a failed body edit, a stuck check or workflow, a failed check the pass did not fix, a `gh` error, a
  person's Greptile thread, an item only the user can do): stop the loop and say what is needed.
- Checks pending: schedule the next pass with `noop: true` when nothing changed. Pick the delay from the
  longest pending job, not a fixed short interval.
- Any other unmet condition (`mergeable` still `UNKNOWN`, Greptile still reviewing): schedule the next pass and
  name the condition it waits for.
