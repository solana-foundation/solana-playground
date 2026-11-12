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
   `compose.yaml`, `update-static.mjs`, and `server/src/routes/share.rs` once HOO-2727 removes it). Never edit `GUARDS` to get past a hit: remove what
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
`client/public` gitlink. The fork keeps the part of them it uses in `client-v2/public/` and records the assets
commit it came from in `client-v2/scripts/assets-commit.txt`. The part is the import list,
`client-v2/scripts/assets-import.txt`: one asset path a line, a trailing `/` for a folder, `#` for a comment. A
tutorial folder that `client-v2/src/tutorials/markdown-tutorials.json` lists is imported whole without a line
there, so enabling a Markdown tutorial is one edit. Upstream's `fonts/`, `icons/`, `frameworks/`, and `pyth/`
are left out: client-v2 takes its code fonts from npm packages, its icons from `lucide-react`, and its
framework logos from `client-v2/src/frameworks/<name>/`, and it has no Pyth generator, so a change upstream
makes there is reported as not imported.

On the polish branch, first run `yarn setup` in the worktree's `client-v2/`. The command loads svgo and sharp
from that folder's `node_modules`, a fresh worktree has none, and `yarn install` alone refuses to run until
`yarn setup` has built the wasm packages. `assets` stops with this instruction when the packages are missing.
Then run `S assets <worktree>`. It reads `<old>` from `assets-commit.txt` and `<new>` from the
`client/public` gitlink of the upstream tip that the last upstream sync subject on the worktree's `HEAD` names
(a third argument, an upstream commit, replaces that tip for a dry run), and stops when they are equal. It
clones the assets repository into `<worktree git dir>/sync-upstream/assets`, or fetches it there, and goes
through `git diff --no-renames --name-status <old> <new>`. Every blob it compares or writes first goes through
`optimiseImage` (`client-v2/scripts/optimise-image.mjs`), which changes SVG, PNG, and JPEG files and returns
any other file as it is, because the fork keeps its images optimised:

- a path the import list does not cover is reported as not imported, and nothing is written;
- a fork-owned path (`FORK_OWNED`: the brand files `favicon*`, `apple-touch-icon.png`, `icon-*.png`,
  `manifest.json`, `og.png`, and `programs/programs.json`) is reported, never written;
- a path whose copy in `client-v2/public/` differs from `<old>`'s optimised blob is reported as changed by the
  fork, never written;
- a path whose copy already equals `<new>`'s optimised blob is counted as current;
- any other path takes upstream's add, change, or delete, with the optimised bytes.

The optimiser's output is the same only for the svgo and sharp versions `client-v2/package.json` pins. A change
that bumps either one runs `node scripts/optimise-image.mjs` over every image in `client-v2/public/`,
`client-v2/src/tutorials/`, and `client-v2/src/frameworks/` in the same change; otherwise this command reports every image as changed by the
fork.

It reports each tutorial folder upstream added with a `data.json` (names starting with `_` excluded) and
upstream's date, without importing it, writes `<new>` to `assets-commit.txt`, prints a summary, and commits
nothing. Then decide with the user:

1. For each fork-owned path and each path the fork changed, show the fork's version and upstream's
   (`git -C <clone> show <new8>:<path>`) and ask which changes to take. `index.html` is not fork-owned: it stays
   upstream's, and the build adds the brand head (`client-v2/scripts/brand-head.mjs`). A build that fails in
   `brandHeadFor` after the copy means upstream restructured the head; update `isBrandTag` there.
2. For each new tutorial, ask whether to enable it. On a yes, add `"<name>": { "added": <the reported date> }`
   to `markdown-tutorials.json` in alphabetical order (the build keeps the file's order), copy the folder with
   the command the summary prints, and run `node scripts/optimise-image.mjs` from `client-v2/` on its images.
3. For a path reported as not imported that the fork now needs, add it to `assets-import.txt` and copy it the
   same way.

## Contract

| Item | Value |
| --- | --- |
| Range | `<to>` parsed from the last upstream sync subject on foundation/master .. solpg/master |
| Merge | `git merge --no-commit --no-ff -X theirs <to>` on the newest foundation/master; `client/` restored to foundation/master |
| Subject | `chore(upstream): merge solpg/master to <to8> (<from8>..<to8>)` |
| Body line | `- <hash8> <subject>`, oldest first; commit body lines become `  * ` sub-bullets. The PR body is the same list |
| Signature | `git commit -S`. `publish` refuses an unsigned commit |
| Branches | `sync/merge-<suffix>` (the merge, pushed to hoodieshq), `sync/polish-<suffix>` (the fork's fixes) |
| State | `<worktree git dir>/sync-upstream/`: target, upstream tip, push lease, message, commit, the assets clone |

Env overrides: `UPSTREAM_REMOTE`, `UPSTREAM_BRANCH`, `TARGET_REMOTE`, `TARGET_BRANCH`, `PUSH_REMOTE`,
`SYNC_BRANCH_PREFIX`, `WORKTREE_ROOT`. A dry run sets `SYNC_BRANCH_PREFIX=dryrun/` so it creates only
`dryrun/merge-<to8>`, and may set `SYNC_NO_SIGN=1` to commit unsigned; `publish` refuses that commit. Remove the
dry run's worktree and branch afterwards.

`node --test .claude/skills/sync-upstream/scripts/sync-upstream.test.mjs` checks the message format against the
merged commit a7a8a1f9, the subject parser against both subject forms, the `GUARDS` matching, the import list
matcher, and that the import list or `FORK_OWNED` covers every file in `client-v2/public/`.

## Common mistakes

- Running `publish` without the user's go-ahead. The push and the PR text are visible to everyone at once.
- Editing the PR title at merge time. The subject is how the next run finds the range.
- Fixing the fork's files inside the merge commit. A rerun of `prepare` discards them; they belong on the polish
  branch.
- Adding attribution trailers to the message or the PR body. The generated text is final.
