# Tasks

Tasks 1.1 and 1.3 may run at the same time. Task 2.1 may run beside group 1.

## 1. The provider layer

- [x] 1.1 Add `DB_PROVIDER` to `databaseEnv()` in
      `client-v2/src/shared/config/server-env.mjs`; move the connection-string
      pool into `features/persistence/model/providers/url.mjs`; make `getPool()`
      in `db.mjs` async, memoised, and delegating by `DB_PROVIDER`; await it in
      `query`, `transaction`, `conversations.mjs`, and `getAuth()`, and await
      `getAuth()` in `api/auth.mjs` and `readSession`. Verify with
      `client-v2/src/features/persistence/model/db.test.mjs` gaining "defaults to
      the url provider", "refuses an unknown provider rather than falling
      back", and "retries a pool that failed to build" (a provider whose first
      `createPool` rejects and whose second resolves), the existing cases
      passing unchanged, `yarn test-api` green against
      the CI service container, and `yarn test-e2e e2e/account-sync.e2e.spec.ts`
      passing. Ticket to file.
- [x] 1.2 Add `providers/cloud-sql.mjs`: `@google-cloud/cloud-sql-connector`,
      `google-auth-library`, and `@vercel/oidc` as dependencies; the
      `ExternalAccountClient` fed by `getVercelOidcToken`;
      `getOptions({ authType: "IAM" })` into `pg.Pool` with the pool limits from
      the `url` provider; `isConfigured` over the `CLOUD_SQL_*` and `GCP_*`
      variables; and the refusal of `CLOUD_SQL_DATABASE=solpg` when `VERCEL_ENV`
      is not `production`, before any token exchange. Each provider's
      variables are declared once, in `features/persistence/config.mjs`, and
      sign-in's `missingConfig` and `scripts/check-agent-env.mjs` require the
      chosen provider's (an unknown `DB_PROVIDER` fails a production build),
      so a production build on Cloud SQL passes without `DATABASE_URL`. Verify with
      `db.test.mjs` cases "reports unconfigured when a Cloud SQL variable is
      missing", "refuses the production database outside production", and "allows
      a preview database outside production", with the connector and the auth
      client stubbed so no case reaches the network; and with
      `client-v2/api/sync.test.mjs` gaining "reports unreachable without detail";
      and with `client-v2/scripts/check-agent-env.test.mjs` gaining "passes a
      production key on Cloud SQL without DATABASE_URL", "fails a production
      key on Cloud SQL without one of its variables", and "fails a production
      key whose DB_PROVIDER names no provider".
      Depends on 1.1. Ticket to file.
- [ ] 1.3 Add `client-v2/scripts/db/preview-name.mjs` (`solpg_preview_pr_<n>`
      for a PR, `solpg_preview_br_<id>` for a laptop branch) and the provisioning
      scripts `scripts/db/url/{create-preview-db,drop-preview-db,migration-url}`
      (wrapping `.github/scripts/neon.sh` and `scripts/neon-preview-branch.sh`)
      and `scripts/db/cloud-sql/{create-preview-db,drop-preview-db,migration-url,migrate-preview-base}`
      (Cloud SQL Auth Proxy; `CREATE DATABASE ... TEMPLATE solpg_preview_base OWNER <preview user>`; the `localhost` URL for dbmate with the session role
      set to the application's user; `migrate-preview-base` lifting
      `ALLOW_CONNECTIONS` for its run and restoring it). Each takes `--pr <n>` or
      `--branch <name>`, never a database name. Point `Makefile.vercel`'s
      `preview-db-branch`, `migrate-preview-db`, and
      `deploy-client-to-vercel-preview` at the generic names, selected by
      `DB_PROVIDER`, with the Neon path's behaviour unchanged. Verify with
      `client-v2/scripts/db/preview-name.test.mjs` ("names a PR's database by its
      number", "cuts a long branch and appends a hash", "keeps branches that
      sanitise alike apart", "keeps a branch apart from the PR it is named like");
      with the three make targets run under `DB_PROVIDER=url` against a stubbed
      `neon.sh`, each printing the expected URL; and under `DB_PROVIDER=cloud-sql`
      against a stubbed `cloud-sql-proxy` and a local Postgres holding a template
      base, where the clone holds the base's rows, dbmate applies only the
      migrations the base lacks, and `\dt` shows every table owned by the
      application's user. Ticket to file.

## 2. Previews on Cloud SQL

- [ ] 2.1 Google Cloud, by hand, written up in `client-v2/docs/cloud-sql.md`:
      create the zonal instance `solpg-preview` (Postgres 17, IAM authentication
      on, connector enforcement required, encrypted only, no authorised network);
      a Workload Identity pool and provider trusting `https://oidc.vercel.com/<team>`
      with `google.subject` mapped to `assertion.sub`; service accounts
      `vercel-production`, `vercel-preview`, and `github-ci`, each bound to its one
      subject (`environment:production`, `environment:preview`, and this
      repository on GitHub's issuer, with an attribute condition naming the
      repository); Cloud SQL Client and Instance User for `vercel-preview`,
      `github-ci`, and the operators on `solpg-preview` only, and for `github-ci`
      nothing on `solpg`; the IAM database users for `vercel-preview`, `github-ci`,
      and the operators on `solpg-preview`; `github-ci` and the operators granted
      the `vercel-preview` role, and `github-ci` `CREATEDB`. Create
      `solpg_preview_base` owned by `vercel-preview`, apply every migration to it
      under that role, and set `IS_TEMPLATE true` and `ALLOW_CONNECTIONS false`.
      Verify by running `cloud-sql-proxy` on a laptop as `github-ci` through its
      federation, cloning the base with `psql` as its IAM user and dropping the
      clone; by `gcloud projects get-iam-policy` showing no `github-ci` binding on
      `solpg`; and by the document listing every `gcloud` command run. Ticket to
      file.
- [ ] 2.2 `preview.yml`: a `preview:cloud-sql` path beside `preview`
      (Cloud SQL wins when both labels are present) that authenticates with
      `google-github-actions/auth` through the GitHub federation, runs
      `create-preview-db` and dbmate through `migration-url`, deploys with
      `-e DB_PROVIDER=cloud-sql -e CLOUD_SQL_DATABASE=<name>` plus the Preview
      environment's `CLOUD_SQL_*` and `GCP_*` variables, and names the database in
      the PR comment; teardown runs `drop-preview-db`. `preview-sweep.yml`: list
      `solpg_preview_pr_*` on `solpg-preview` through the proxy and drop those
      whose PR is closed or unlabelled, honouring `MIN_AGE_MINUTES` and `dry_run`,
      and never touching `solpg_preview_base` or `solpg_preview_br_*`.
      Document the label in `client-v2/docs/neon.md` (renamed to
      `client-v2/docs/preview-databases.md`, with `neon.md` left as a one-line
      pointer), including the base and when to run `migrate-preview-base`, and the
      Preview variables in `deploy-client-vercel.md`. Verify with
      a labelled PR whose comment names the database and whose preview URL
      answers `{ "enabled": true, "db": "ok" }` on `GET /api/sync`; removing the
      label drops the database; a dry-run sweep lists nothing for an open labelled
      PR. Depends on 1.2, 1.3, 2.1. Ticket to file.
- [ ] 2.3 Add the gates that are not code to `client-v2/docs/cloud-sql.md`
      with their check commands: the `vercel-preview` and `github-ci` bindings
      conditioned on `solpg-preview`, and the reviewer check that no workflow input or make
      variable sets `CLOUD_SQL_DATABASE`. Verify by running each check command
      and pasting its output into the PR. Depends on 2.2. Ticket to file.
- [ ] 2.4 Walk through every `(manual)` scenario of `client-v2-preview-database`
      and the preview scenarios of `client-v2-database-provider` on a PR labelled
      `preview:cloud-sql`: sign-in, a project edited in one browser appearing in
      a second, a pushed migration applied, the label removed. Record the results
      in that PR, with the cold and warm latency of `GET /api/sync` and the
      functions' region. Depends on 2.2. Ticket to file.

## 3. Production on Cloud SQL

- [ ] 3.1 Instance `solpg`: set `cloudsql.iam_authentication=on`,
      `connectorEnforcement=REQUIRED`, `ssl_mode=ENCRYPTED_ONLY`; grant
      `vercel-production` Cloud SQL Client and Instance User on `solpg` only,
      conditioned on that instance, and add it as an IAM database user there
      (`gcloud sql users create <sa>@<project>.iam --instance=solpg --type=cloud_iam_service_account`); create the empty
      database `solpg` owned by the `vercel-production` IAM user; `REVOKE CONNECT ON DATABASE solpg FROM PUBLIC`; add each operator as an IAM database user on
      `solpg` with Cloud SQL Client and Instance User there, a member of the
      `vercel-production` role, and list them in `client-v2/docs/cloud-sql.md`.
      Rewrite `migrate-production-db` in `Makefile.vercel` to read Production's
      `DB_PROVIDER` from the variables it already pulls and migrate that one
      database: the production Neon project through its unpooled URL for `url` or
      unset, `solpg` through the proxy as the operator (`--auto-iam-authn`, the
      session role set to the production user) for `cloud-sql`; print the host,
      the database, and the pending list, and ask once. Record the pool sizing
      (`max_connections`, the pool's `max`, the concurrent instance count from
      Vercel, the date) in `client-v2/docs/cloud-sql.md`. Verify with
      `gcloud sql instances describe solpg` showing the three settings,
      `\l solpg` showing `CONNECT` for the production user only, a direct `psql`
      to port 5432 refused, a staged production deployment
      (`vercel deploy --prod --skip-domain` with `-e DB_PROVIDER=cloud-sql`,
      the `CLOUD_SQL_*` and `GCP_*` variables, and `-e SYNC_ENABLED=false`)
      answering `{ "enabled": false, "db": "ok" }` on `GET /api/sync` with the
      instance log naming the production IAM user, which proves the
      application's own identity reaches `solpg` (the operator checks do not), `migrate-production-db` still naming the production
      Neon host and "nothing to apply" while Production is on `url`, and
      `dbmate status` through `migration-url production` as an operator listing
      every migration pending on `solpg`. Depends on 1.3, 2.1. Ticket to file.
- [ ] 3.2 Cutover, after 2.4's results are recorded, with sync on throughout:
      confirm with the team that production still has no users, and stop if it
      has (a copy behind a freeze is then needed, outside this change); apply
      every migration to `solpg` with
      `scripts/db/cloud-sql/migration-url production -- dbmate --no-dump-schema up`
      as an operator, the Cloud SQL values given inline since Production does
      not name them yet; set `DB_PROVIDER=cloud-sql`, the `CLOUD_SQL_*` and
      `GCP_*` variables on Production and remove `DATABASE_URL` and
      `DATABASE_URL_UNPOOLED`; redeploy; `GET /api/sync` answers
      `{ "enabled": true, "db": "ok" }`; `migrate-production-db` names `solpg`
      and reports nothing to apply. Leave the production Neon project
      untouched as the rollback. Update `deploy-client-vercel.md` ("Release
      checklist", "Conversation and project sync") and the root `CLAUDE.md`
      gotcha on the production database. Verify by `\dt` showing every table
      owned by the production user before the switch, the `GET /api/sync`
      body after it, and a sign-in and project edit on the production domain
      writing a row to `solpg`, all recorded in the PR. Depends on 2.4, 3.1.
      Ticket to file.
- [ ] 3.3 Add a `smoke` job to `client-v2.yml` on push to `master` that waits
      for the Vercel deployment of the pushed commit and fails unless its
      `GET /api/sync` answers `{ "enabled": true, "db": "ok" }`, naming the URL
      and the body on failure. Verify with one green run after a push and one
      red run against a deployment whose `SYNC_ENABLED` is off. Depends on 3.2.
      Ticket to file.
- [ ] 3.4 Finish `client-v2/docs/cloud-sql.md` as the guide for maintainers of
      `solana-foundation/solana-playground`: a design section (identities and
      the instances they reach, the four gates, which workflow creates,
      migrates, and drops which database, who migrates production), then the
      setup steps in order for Google Cloud, Vercel, and GitHub, adding an
      operator, and the cutover and rollback runbook, with every value
      specific to this deployment as a placeholder. Link it from
      `deploy-client-vercel.md` and `preview-databases.md`. Verify by the
      four `(manual)` scenarios of "A maintainer guide sets the pipeline up
      from nothing" in `client-v2-production-database`, checked on the PR by
      someone who did not run tasks 2.1 and 3.1. Depends on 2.3, 3.2. Ticket
      to file.
