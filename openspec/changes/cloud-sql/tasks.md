# Tasks

Tasks 1.1 and 1.3 may run at the same time. Task 2.1 may run beside group 1.

## 1. The provider layer

- [ ] 1.1 Add `DB_PROVIDER` to `databaseEnv()` in
  `client-v2/src/shared/config/server-env.mjs`; move the connection-string
  pool into `features/persistence/model/providers/url.mjs`; make `getPool()`
  in `db.mjs` async, memoised, and delegating by `DB_PROVIDER`; await it in
  `query`, `transaction`, `conversations.mjs`, and `getAuth()`, and await
  `getAuth()` in `api/auth.mjs` and `readSession`. Verify with
  `client-v2/src/features/persistence/model/db.test.mjs` gaining "defaults to
  the url provider" and "refuses an unknown provider rather than falling
  back", the existing cases passing unchanged, `yarn test-api` green against
  the CI service container, and `yarn test-e2e e2e/account-sync.e2e.spec.ts`
  passing. Ticket to file.
- [ ] 1.2 Add `providers/cloud-sql.mjs`: `@google-cloud/cloud-sql-connector`,
  `google-auth-library`, and `@vercel/oidc` as dependencies; the
  `ExternalAccountClient` fed by `getVercelOidcToken`;
  `getOptions({ authType: "IAM" })` into `pg.Pool` with the pool limits from
  the `url` provider; `isConfigured` over the `CLOUD_SQL_*` and `GCP_*`
  variables; and the refusal of `CLOUD_SQL_DATABASE=solpg` when `VERCEL_ENV`
  is not `production`, before any token exchange. Verify with
  `db.test.mjs` cases "reports unconfigured when a Cloud SQL variable is
  missing", "refuses the production database outside production", and "allows
  a preview database outside production", with the connector and the auth
  client stubbed so no case reaches the network; and with
  `client-v2/api/sync.test.mjs` gaining "reports unreachable without detail".
  Depends on 1.1. Ticket to file.
- [ ] 1.3 Add `client-v2/scripts/db/preview-name.mjs` and the provisioning
  scripts `scripts/db/url/{create-preview-db,drop-preview-db,migration-url}`
  (wrapping `.github/scripts/neon.sh` and `scripts/neon-preview-branch.sh`)
  and `scripts/db/cloud-sql/{create-preview-db,drop-preview-db,migration-url}`
  (Cloud SQL Auth Proxy, `CREATE DATABASE ... OWNER`, the `localhost` URL for
  dbmate). Point `Makefile.vercel`'s `preview-db-branch`, `migrate-preview-db`,
  and `deploy-client-to-vercel-preview` at the generic names, selected by
  `DB_PROVIDER`, with the Neon path's behaviour unchanged. Verify with
  `client-v2/scripts/db/preview-name.test.mjs` ("names a database after a
  short branch", "cuts a long branch and appends a hash", "keeps branches that
  sanitise alike apart"), and with the three make targets run under
  `DB_PROVIDER=url` against a stubbed `neon.sh` and under
  `DB_PROVIDER=cloud-sql` against a stubbed `cloud-sql-proxy` and a local
  Postgres, each printing the expected URL. Ticket to file.

## 2. Previews on Cloud SQL

- [ ] 2.1 Google Cloud, by hand, written up in `client-v2/docs/cloud-sql.md`:
  create the zonal instance `solpg-preview` (Postgres 17, IAM authentication
  on, connector enforcement required, encrypted only, no authorised network);
  a Workload Identity pool and provider trusting `https://oidc.vercel.com/<team>`
  with `google.subject` mapped to `assertion.sub`; service accounts
  `vercel-production`, `vercel-preview`, and `github-ci`, each bound to its one
  subject (`environment:production`, `environment:preview`, and this
  repository on GitHub's issuer); Cloud SQL Client and Instance User for
  `vercel-preview` and `github-ci` on `solpg-preview` only; the three IAM
  database users on `solpg-preview`; `GITHUB_CI` granted the `vercel-preview`
  role. Verify by running `cloud-sql-proxy` on a laptop as `github-ci`
  through its federation and connecting with `psql` as its IAM user, and by
  the document listing every `gcloud` command run. Ticket to file.
- [ ] 2.2 `preview.yml`: a `preview:cloud-sql` path beside `preview`
  (Cloud SQL wins when both labels are present) that authenticates with
  `google-github-actions/auth` through the GitHub federation, runs
  `create-preview-db` and dbmate through `migration-url`, deploys with
  `-e DB_PROVIDER=cloud-sql -e CLOUD_SQL_DATABASE=<name>` plus the Preview
  environment's `CLOUD_SQL_*` and `GCP_*` variables, and names the database in
  the PR comment; teardown runs `drop-preview-db`. `preview-sweep.yml`: list
  `solpg_preview_*` on `solpg-preview` through the proxy and drop those whose
  PR is closed or unlabelled, honouring `MIN_AGE_MINUTES` and `dry_run`.
  Document the label in `client-v2/docs/neon.md` (renamed to
  `client-v2/docs/preview-databases.md`, with `neon.md` left as a one-line
  pointer) and the Preview variables in `deploy-client-vercel.md`. Verify with
  a labelled PR whose comment names the database and whose preview URL
  answers `{ "enabled": true, "db": "ok" }` on `GET /api/sync`; removing the
  label drops the database; a dry-run sweep lists nothing for an open labelled
  PR. Depends on 1.2, 1.3, 2.1. Ticket to file.
- [ ] 2.3 Add the gates that are not code to `client-v2/docs/cloud-sql.md`
  with their check commands: the `vercel-preview` bindings conditioned on
  `solpg-preview`, and the reviewer check that no workflow input or make
  variable sets `CLOUD_SQL_DATABASE`. Verify by running each check command
  and pasting its output into the PR. Depends on 2.2. Ticket to file.
- [ ] 2.4 Walk through every `(manual)` scenario of `client-v2-preview-database`
  and the preview scenarios of `client-v2-database-provider` on a PR labelled
  `preview:cloud-sql`: sign-in, a project edited in one browser appearing in
  a second, a pushed migration applied, the label removed. Record the results
  in that PR. Depends on 2.2. Ticket to file.

## 3. Production on Cloud SQL

- [ ] 3.1 Instance `solpg`: set `cloudsql.iam_authentication=on`,
  `connectorEnforcement=REQUIRED`, `ssl_mode=ENCRYPTED_ONLY`; create database
  `solpg` owned by the `vercel-production` IAM user; `REVOKE CONNECT ON
  DATABASE solpg FROM PUBLIC`; grant `github-ci` the `vercel-production` role
  and Cloud SQL Client and Instance User on `solpg`. Rewrite
  `migrate-production-db` in `Makefile.vercel` to migrate `solpg` through the
  proxy and Neon `main` through its unpooled URL, print both hosts and both
  pending lists, ask once, and name a target left behind. Apply every
  migration to the empty `solpg`. Record the pool sizing (`max_connections`,
  the pool's `max`, the concurrent instance count from Vercel, the date) in
  `client-v2/docs/cloud-sql.md`. Verify with `gcloud sql instances describe
  solpg` showing the three settings, `\l solpg` showing `CONNECT` for the
  production user only, a direct `psql` to port 5432 refused, and
  `migrate-production-db` printing both hosts and "nothing to apply" after
  the run. Depends on 1.3, 2.1. Ticket to file.
- [ ] 3.2 Cutover, after 2.4's results are recorded: `SYNC_ENABLED=false` on
  Production and redeploy; `pg_dump` Neon `main` and `pg_restore` into
  `solpg` through the proxy; compare `select count(*)` per table; set
  `DB_PROVIDER=cloud-sql`, the `CLOUD_SQL_*` and `GCP_*` variables on
  Production and remove `DATABASE_URL`; redeploy; `GET /api/sync` answers
  `db: "ok"`; `SYNC_ENABLED=true` and redeploy. Update
  `deploy-client-vercel.md` ("Release checklist", "Conversation and project
  sync") and the root `CLAUDE.md` gotcha on the production database. Verify
  by the row counts and the three `GET /api/sync` bodies recorded in the PR.
  Depends on 2.4, 3.1. Ticket to file.
- [ ] 3.3 Add a `smoke` job to `client-v2.yml` on push to `master` that waits
  for the Vercel deployment of the pushed commit and fails unless its
  `GET /api/sync` answers `{ "enabled": true, "db": "ok" }`, naming the URL
  and the body on failure. Verify with one green run after a push and one
  red run against a deployment whose `SYNC_ENABLED` is off. Depends on 3.2.
  Ticket to file.
