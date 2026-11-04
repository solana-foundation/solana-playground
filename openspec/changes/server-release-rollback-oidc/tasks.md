# Tasks

All tasks: HOO-484. Plan: [plans/1-release-workflow.md](plans/1-release-workflow.md).

## 1. Target selection

- [x] 1.1 Write `client-v2/scripts/lib/release/resolve-target.mjs` test-first, covering every scenario of the `server-release` spec's promote, refuse and rollback requirements; verify with `yarn test-api`

## 2. Auth

- [x] 2.1 Add the composite `.github/actions/gcp-auth` and use it in `cicd.yml` with `id-token: write` on `deploy_server`, leaving `--no-promote` as is; verify with `actionlint` and by reading both resolved paths

## 3. Promote and rollback workflow

- [x] 3.1 Add `.github/workflows/server-release.yml` (depends on 1.1, 2.1): `master` only, input through `env`, read-back check, job summary; verify with `actionlint`, and by running its shell steps against a stubbed `gcloud` for a promote, a rollback, a no-op and a refusal

## 4. Documentation

- [x] 4.1 Add `docs/server-release.md`: how to promote and roll back, the gcloud commands for the pool, provider, attribute condition and role, the variable to set, and the steps to retire `GCP_KEY`; in `server/README.md` replace the manual cutover sentence with a pointer to it (the only edit under `server/`); verify each gcloud command against Google's reference for its flags
