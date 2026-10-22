# Cloud SQL for production Postgres

- **Execution mode:** loop
- **Specs (source of truth):** OpenSpec change `cloud-sql`, branch `spec/cloud-sql` on hoodieshq (commit `e99a4d56f`), worktree `.worktrees/spec/cloud-sql`; its `openspec/changes/cloud-sql/tasks.md` is the task list and is not repeated here
- **Artifact:** none
- **Commands:** /sx:plan status · save · run (optional: share · fetch)

## Steps

- [ ] Step 1: Open the PR for `spec/cloud-sql` against `hoodieshq` `master`; _done when:_ the PR exists and `spec:validate` is green on it
- [ ] Step 2: Decide one IAM database user or two (app and migrations); _done when:_ `design.md`'s open question is replaced by the decision and task 3.1 names the users
- [ ] Step 3: Find the Vercel functions' region and compare it with `solpg`'s `us-central1`; _done when:_ `design.md` records the region and whether the functions move
- [ ] Step 4: Confirm with the owner of the `analytics-324114` project that `solpg` (empty since 2025-07-20, regional HA) is ours to use for production; _done when:_ the answer is in `design.md`
- [ ] Step 5: Push `fix/node-22-23-4` (commit `c42e3328`, worktree `.worktrees/fix/node-22-23-4`) and open its PR; _done when:_ CI on the PR installs Node 22.23.4 in both clients
- [ ] Step 6: Remove the worktrees whose branches are merged (`git worktree list` showed 28 on 2026-10-22); _done when:_ only live branches remain under `.worktrees/`
- [ ] Step 7: Implement the change through `/opsx:apply cloud-sql`, one task per PR in `tasks.md` order; _done when:_ every task is ticked and the smoke job on push to `master` passes against `solpg`

## Progress / intermediary results

2026-10-22: proposal written and pushed. Deviations from the discussed design, both recorded in the artifacts:
`GET /api/sync` is the smoke probe (it already answers `db: ok|unreachable|unconfigured`), run from `client-v2.yml`
on push to `master`, so `api/health.mjs` stays as is; and no GitHub Actions federation to GCP exists on `master`
(`cicd.yml` uses the `GCP_KEY` JSON secret), so task 2.1 creates the pool, provider, and `github-ci` service account.
Verified the same day: `cloud-sql-proxy --gcloud-auth analytics-324114:us-central1:solpg` plus `psql` reaches
Postgres on `solpg` with no instance change; the password prompt was the proof, no password entered.
