# Server release: promote, rollback, OIDC. Implementation plan

> Executed inline with superpowers:executing-plans.

**Goal:** the four task groups of [`tasks.md`](https://github.com/solana-foundation/solana-playground/blob/2ae7a1132881dead7e745014d0e74bda081cbdd7/openspec/changes/server-release-rollback-oidc/tasks.md).

**Spec:** `../specs/server-release/spec.md`, `../design.md`.

## Global constraints

- Service `playground-server`. Variable `GCP_WORKLOAD_IDENTITY_PROVIDER`; secrets `GCP_KEY`, `SERVICE_ACCOUNT`, `PROJECT_ID`.
- Pins: `google-github-actions/auth@7b53cdc2a387814ed14eec026287aac689ae8c9b # v2.1.9`, `google-github-actions/setup-gcloud@e427ad8a34f8676edf47cf7d7925499adf3eb74f # v2.2.1`.
- `--no-promote` stays. The only edit under `server/` is the README pointer.

## Review focus

- Traffic of `0.99995` from float rounding reads as all traffic; a real `0.999` split does not.
- An unparsable `createTime` refuses rather than sorting as `NaN`.
- Two versions created at the same instant: neither counts as "before" the other.
- A split list with a named target still promotes, reported as `split` before.
- An empty list refuses.

## Task 1: `client-v2/scripts/lib/release/resolve-target.mjs`

Test: `resolve-target.test.mjs` beside it, run with `yarn test-api`.

Produces:

- `selectTarget(requested, versions) -> { current: string | undefined, target: string, isChanged: boolean }`, throws `Error` on every refusal in the spec.
- `assertLive(versions, target) -> void`, throws unless `target` holds all traffic.
- CLI: `node resolve-target.mjs select` (env `REQUESTED_VERSION`) prints `current=`, `target=`, `changed=` lines for `$GITHUB_OUTPUT`, with `current=split` for `undefined`. `node resolve-target.mjs verify` (env `TARGET_VERSION`). Both read the list on stdin, print the refusal as `::error::` and exit 1.

Steps: failing tests from each spec scenario, run, implement, run, commit.

## Task 2: `.github/actions/gcp-auth/action.yml`, `cicd.yml`

Composite with inputs `workload_identity_provider`, `service_account`, `credentials_json`, `project_id`; `cicd.yml` drops its auth step for it, adds `id-token: write` on `deploy_server`. Verify with `actionlint`. Commit.

## Task 3: `.github/workflows/server-release.yml`

`workflow_dispatch`, input `version`; a `check_branch` job that fails off `master`, which `release` needs; `concurrency: server-release` on `release`; the plan written to the summary before the move. Verify with `actionlint` and by running the steps' shell against a stub `gcloud` on `PATH` for a promote, a rollback, a no-op and a refusal. Commit.

## Task 4: `docs/server-release.md`, README pointer

Per [`tasks.md`](https://github.com/solana-foundation/solana-playground/blob/2ae7a1132881dead7e745014d0e74bda081cbdd7/openspec/changes/server-release-rollback-oidc/tasks.md) 4.1. Commit.
