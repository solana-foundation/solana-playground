---
name: sync-upstream
description: Use when foundation/master is behind solpg/master and the upstream commits must land on the foundation fork as one merge PR, or when asked to "sync upstream", "pull solpg into foundation", "merge solpg/master", or "refresh the sync PR".
---

# Sync upstream

## Overview

foundation/master holds the fork's tree, so upstream arrives as a real merge of solpg/master on a sync branch,
resolved in favour of upstream (`-X theirs`). The foundation repository merges PRs only by squash or rebase, so
the merge parent does not survive on master: the next sync finds its start point by parsing the subject of the
last upstream sync commit on foundation/master. Both subject forms are read:

- `chore(upstream): sync to <to8> (<from8>..<to8>)`, the squash syncs up to ae29b59c1;
- `chore(upstream): merge solpg/master to <to8> (<from8>..<to8>)`, the merge syncs.

`client/` is upstream's client, which the fork keeps at foundation/master's state until it is deleted (HOO-2686).
The script restores it after the merge and refuses to commit while it differs.

Run every command from a checkout of this repository, with Node 22 or later. The script is
[scripts/sync-upstream.mjs](scripts/sync-upstream.mjs) and needs no dependencies; `S` below stands for
`node .claude/skills/sync-upstream/scripts/sync-upstream.mjs`.

## Steps

1. **Prepare.** Run `S prepare`. It fetches `solpg` and `foundation`, picks the sync branch, rebuilds it from
   the newest foundation/master in its worktree, merges solpg/master with `-X theirs`, restores `client/`,
   checks the guard list, and commits the merge signed when nothing conflicts. The sync branch is the head
   branch of an open sync PR from hoodieshq when one exists (so a rerun refreshes that PR, as foundation PR #85
   on `sync/merge-1693239d` needs), and `sync/merge-<to8>` otherwise. Its worktree is the one that already
   holds the branch, or `.worktrees/<branch>` in the main checkout.
2. **Resolve conflicts.** When `prepare` stops on unmerged paths, resolve them in the worktree it names.
   A conflict on a fork-owned path (`client-v2/`, `docs/`, `openspec/`) keeps foundation/master's version:
   `git -C <worktree> checkout <foundation/master sha> -- <path>`. The rename/rename conflict between
   upstream's `client/src/commands/run-and-test/common.ts` and the fork's
   `client-v2/src/commands/run-and-test/run-and-test.ts` is one of these: the merge leaves the fork's file holding
   mostly upstream's `common.ts`, and `git diff` against foundation/master does not show it while the path is
   unmerged. Stage the result, then run `S commit <worktree>`.
3. **Read the stop reasons.** `commit` refuses while `client/` differs from foundation/master, and while the merge
   brings back a path or content in `GUARDS` that foundation/master lacks (the upstream client services in
   `compose.yaml`, `update-static.mjs`, the `client/public` submodule entry, and
   `server/src/routes/share.rs` once HOO-2727 removes it). Never edit `GUARDS` to get past a hit: remove what
   came back.
4. **Check what the merge deleted.** `-X theirs` also takes upstream's deletions of files the fork still needs.
   List them with `git -C <worktree> diff --no-renames --diff-filter=D --name-only <foundation/master sha> HEAD`
   and show the list to the user. A dry run to 8cbb3b73 deleted the fork's `server/templates/anchor-1.1.2/`,
   which the stable backend needs. Fixes go on the polish branch (step 7), never into the merge commit.
5. **Wait for the go-ahead.** Show the user the printed message and the findings of step 4. `publish` pushes to
   hoodieshq and opens or edits a PR on the foundation repository. Run it only after the user's explicit
   go-ahead for this publish; an earlier approval does not carry over.
6. **Publish.** Run `S publish <worktree>`. It refuses an unsigned commit or a branch that moved since
   `prepare`, pushes with `--force-with-lease` against the remote tip `prepare` recorded, and then either edits
   the open PR's title and body (`gh pr edit`) or opens one: `--repo solana-foundation/solana-playground
   --base master --head hoodieshq:<branch>`. The title is the commit subject; the body is the commit list.
   Report the PR link.
7. **Polish branch.** The fork's fixes after `-X theirs` (restored fork files, adaptations to upstream's
   changes, the assets step) go on `sync/polish-<suffix>`, branched from the merge branch with the same suffix,
   one commit per fix. A rerun of `prepare` replaces the merge commit, so rebase the polish branch onto the new
   merge commit afterwards. Open its PR only when the user asks.
8. **Merge on GitHub.** The merge PR lands with "Squash and merge" and its generated title unchanged: the next
   run reads `<to8>` from that subject.

## Assets step

Upstream's assets live in `https://github.com/solana-playground/assets.git`, which upstream pins as the
`client/public` gitlink. The fork keeps a copy in `client-v2/public/` and records the assets commit it came
from in `client-v2/scripts/assets-commit.txt`. Do this by hand on the polish branch:

1. Read `<old>` from `assets-commit.txt` and `<new>` from `git ls-tree <to> client/public`. Stop when they
   are equal.
2. Clone the assets repository with full history into a scratch folder outside the repository, and list the
   changes: `git -C <assets> diff --no-renames --name-status <old> <new>`.
3. A file the fork never changed is one whose copy in `client-v2/public/` equals `git -C <assets> show
   <old>:<path>`. For those, apply the change as is: copy added and modified files from `<new>`, delete deleted
   ones. New tutorial folders are copied whole, like any other added file.
4. A file the fork changed is never overwritten: the brand files (`favicon*`, `apple-touch-icon.png`,
   `icon-*.png`, `manifest.json`, `og.png`) and `programs/programs.json`. Show the user the fork's version and
   upstream's `<new>` version, and ask which changes to take. `index.html` is not one of them: it stays
   upstream's, and the build adds the brand head (`client-v2/scripts/brand-head.mjs`), so it is copied as is.
   A build that fails in `brandHeadFor` after the copy means upstream restructured the head; update
   `isBrandTag` there.
5. A copied tutorial folder does not show in the app until
   `client-v2/src/tutorials/markdown-tutorials.json` lists it. For each new `tutorials/<name>/` with a
   `data.json` (names starting with `_` excluded), report the name and upstream's date, the last line of
   `git -C <assets>/tutorials/<name> log --follow --format=%ad --date=unix --diff-filter=A .`, and ask the user
   whether to enable it. On a yes, add `"<name>": { "added": <that date> }` to `markdown-tutorials.json`, in
   alphabetical order: the build keeps the file's order.
6. Write `<new>` (full sha) to `assets-commit.txt`.

## Contract

| Item | Value |
| --- | --- |
| Range | `<to>` parsed from the last upstream sync subject on foundation/master .. solpg/master |
| Merge | `git merge --no-commit --no-ff -X theirs <to>` on the newest foundation/master; `client/` restored to foundation/master |
| Subject | `chore(upstream): merge solpg/master to <to8> (<from8>..<to8>)` |
| Body line | `- <hash8> <subject>`, oldest first; commit body lines become `  * ` sub-bullets. The PR body is the same list |
| Signature | `git commit -S`. `publish` refuses an unsigned commit |
| Branches | `sync/merge-<suffix>` (the merge, pushed to hoodieshq), `sync/polish-<suffix>` (the fork's fixes) |
| State | `<worktree git dir>/sync-upstream/`: target, upstream tip, push lease, message, commit |

Env overrides: `UPSTREAM_REMOTE`, `UPSTREAM_BRANCH`, `TARGET_REMOTE`, `TARGET_BRANCH`, `PUSH_REMOTE`,
`SYNC_BRANCH_PREFIX`, `WORKTREE_ROOT`. A dry run sets `SYNC_BRANCH_PREFIX=dryrun/` so it creates only
`dryrun/merge-<to8>`, and may set `SYNC_NO_SIGN=1` to commit unsigned; `publish` refuses that commit. Remove the
dry run's worktree and branch afterwards.

`node --test .claude/skills/sync-upstream/scripts/sync-upstream.test.mjs` checks the message format against the
merged commit a7a8a1f9, the subject parser against both subject forms, and the `GUARDS` matching.

## Common mistakes

- Running `publish` without the user's go-ahead. The push and the PR text are visible to everyone at once.
- Editing the PR title at merge time. The subject is how the next run finds the range.
- Fixing the fork's files inside the merge commit. A rerun of `prepare` discards them; they belong on the polish
  branch.
- Adding attribution trailers to the message or the PR body. The generated text is final.
