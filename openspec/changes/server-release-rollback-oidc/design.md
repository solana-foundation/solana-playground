# Design

## Context

`cicd.yml` deploys `server/` to App Engine flex on a tagged push or manual dispatch, with `--no-promote`, authenticating with `credentials_json: secrets.GCP_KEY`. Motivation is in proposal.md. `client-v2/scripts/lib/bundle/locate-pr.mjs` sets the precedent for logic used by a workflow: a plain `.mjs` with `node --test` cases, run by `yarn test-api`.

## Goals / Non-Goals

**Goals:** target selection covered by tests without GCP access; no interruption of deploys at merge.

**Non-Goals:** canary or split traffic; deleting old versions; removing `GCP_KEY` (a human step after the pool exists, then a one-line follow-up).

## Decisions

**One workflow, optional input, not separate promote and rollback workflows.** Rollback is a promote whose target is computed. Name: `server-release.yml`, input `version`.

**Selection is a tested script, gcloud stays in the workflow.** `client-v2/scripts/lib/release/resolve-target.mjs` reads the version list as JSON on stdin plus the requested version, and prints the target and the current version, or fails. Alternative, `jq` inside YAML: no tests, and these failure paths are the point of the change. The workflow passes the input through `env`, never `${{ }}` inside `run`, so input cannot inject shell.

**Fail closed on the list's shape.** The script reads `id`, `traffic_split`, `version.servingStatus` and `version.createTime`, and refuses a record missing any. The names are taken from gcloud's source (`surface/app/versions/list.py`, `api_lib/app/version_util.py`), and "all traffic" uses its epsilon of 1e-4, since the smallest real split is 0.001. No real project was listed while building this, so the first real run is a named-version promote of the live version, which is a no-op; a wrong assumption shows as a red run with traffic untouched.

**One auth step shared by a composite action.** `.github/actions/gcp-auth` takes the provider, service account and key as inputs, since a composite cannot read secrets, and passes each to `google-github-actions/auth` with an expression that leaves the unused path empty. Alternative, copying the expressions: two workflows would drift, and the key path is meant to be removed in one place. `SERVICE_ACCOUNT` is reused, so `GCP_WORKLOAD_IDENTITY_PROVIDER` is the only new setting.

**The GCP provider is restricted to this repository and `master`.** The setup document's attribute condition is `assertion.repository_id` of this repository `&& assertion.ref == 'refs/heads/master'`; the id, because a repository name can be re-registered after a rename. The workflow's own branch check can be edited by anyone who pushes a branch; the condition cannot, so once the key is gone a dispatched branch with a modified workflow gets no token. Both triggers of `cicd.yml` run on `master` in normal use, and the condition applies to it too.

**Least privilege per job.** `id-token: write` is set on the deploy and promote jobs only, and `contents: read` stays the default. `google-github-actions/auth` and `setup-gcloud` are pinned to a SHA on their current major, as newer workflows here do, because they now hold the token.

**The document goes in `docs/server-release.md`; `server/README.md` gets one line.** `openspec/config.yaml` and the repo's CLAUDE.md keep `server/` out of scope, so the procedure lives in `docs/`. The README's manual cutover sentence is replaced by a pointer to it, the one exception (Slava, 2026-11-05), so the README gives no wrong instruction.

## Risks / Trade-offs

- [The JSON differs from what gcloud's source implies] → fail closed; verified by the first no-op run above.
- [A rollback lands on an old version whose data expectations no longer hold] → the summary names both versions; the server has no migrations run by this workflow.
- [Rollback by creation time can land on a version that was parked and never live, since App Engine keeps no history] → the input and the document say so and the summary names the target; a named version is the way around it. Tracking history would need state of our own, which this change does not add.
- [The `master` condition blocks a dispatch from a branch during an incident] → intended; the hotfix path is a named-version run from `master`.

## Migration Plan

1. Merge: nothing changes, the key path is used.
2. Someone with IAM rights runs the commands in `docs/server-release.md` and sets `GCP_WORKLOAD_IDENTITY_PROVIDER`.
3. The no-op promote proves OIDC and the list format. A rollback and a promote back prove the rest.
4. The next tagged release deploys through OIDC; then `GCP_KEY` is deleted and the service account's key revoked.

To back out at step 2 or later, clear the variable: runs return to the key until it is deleted.
