# Tasks

Production goes first. Group 3 needs group 1 and nothing from group 2: task
3.1 creates the production identity itself. Group 2 follows the Breakpoint
launch (11 Nov 2026); until then every preview stays on Neon, with
`DB_PROVIDER` unset on the Preview environment. Task 3.3 may run before or
after 3.5; task 3.4 waits for group 2. Tasks 1.1 and 1.3 may run at the same
time.

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
- [x] 1.3 Add `client-v2/scripts/db/preview-name.mjs` (`solpg_preview_pr_<n>`
      for a PR, `solpg_preview_br_<id>` for a laptop branch) and the provisioning
      scripts `scripts/db/url/{create-preview-db,drop-preview-db,migration-url}`
      (wrapping `.github/scripts/neon.sh` and `scripts/neon-preview-branch.sh`)
      and `scripts/db/cloud-sql/{create-preview-db,drop-preview-db,migration-url}`
      (Cloud SQL Auth Proxy; `create-preview-db` creates an empty database
      owned by the preview user and restores `pg_dump` of `solpg_preview` into
      it, without the rows of `session`, stamping the database's comment
      `copying:<epoch>`, then `created-at:<epoch>`; the `localhost` URL for
      dbmate with the session role set to the application's user;
      `migration-url production` and `migration-url shared` exist in this set
      only). Each takes `--pr <n>` or `--branch <name>`, never a database
      name. Point `Makefile.vercel`'s
      `preview-db-branch`, `migrate-preview-db`, and
      `deploy-client-to-vercel-preview` at the generic names, selected by
      `DB_PROVIDER`, with the Neon path's behaviour unchanged;
      `migrate-preview-db` reads `CLOUD_SQL_INSTANCE` and `CLOUD_SQL_USER`
      from the Preview environment's pull only, never the shell, and refuses
      an instance other than `solpg-preview`. Verify with
      `client-v2/scripts/db/preview-name.test.mjs` ("names a PR's database by its
      number", "cuts a long branch and appends a hash", "keeps branches that
      sanitise alike apart", "keeps a branch apart from the PR it is named like");
      with the three make targets run under `DB_PROVIDER=url` against a stubbed
      `neon.sh`, each printing the expected URL; and under `DB_PROVIDER=cloud-sql`
      against a stubbed `cloud-sql-proxy` and a local Postgres standing in for
      `solpg_preview`, where the copy holds its rows but none of `session`,
      dbmate applies only the migrations the copy lacks, and `\dt` shows every table owned by the
      application's user. Ticket to file.

## 2. Previews on Cloud SQL (after the Breakpoint launch)

- [ ] 2.1 Google Cloud, by hand, written up in `client-v2/docs/cloud-sql.md`:
      create the zonal instance `solpg-preview` (Postgres 17, IAM authentication
      on, connector enforcement required, encrypted only, no authorised network);
      on the Vercel pool and provider that task 3.1 creates, the service account
      `vercel-preview` bound to `environment:preview`; a pool and provider
      trusting GitHub's issuer, and the service account `github-ci` bound to
      this repository there, with an attribute condition naming the
      repository; Cloud SQL Client and Instance User for `vercel-preview`,
      `github-ci`, and the operators on `solpg-preview` only, and for `github-ci`
      nothing on `solpg`; the IAM database users for `vercel-preview`, `github-ci`,
      and the operators on `solpg-preview`; `github-ci` and the operators granted
      the `vercel-preview` role, and `github-ci` `CREATEDB`. Create
      the shared database `solpg_preview` owned by `vercel-preview` and
      apply every migration to it under that role. Verify by running
      `cloud-sql-proxy` on a laptop as `github-ci` through its federation,
      running `create-preview-db --branch <name>` as its IAM user and dropping
      the copy; by
      `\dt` on `solpg_preview` showing every table owned by `vercel-preview`; by
      `gcloud projects get-iam-policy` showing no `github-ci` binding on `solpg`;
      and by the document listing every `gcloud` command run. Ticket to file.
- [ ] 2.2 `preview.yml`: the `preview` label's path chosen by the repository
      variable `PREVIEW_DB_PROVIDER`. With `cloud-sql`, the deploy job
      authenticates with `google-github-actions/auth` through the GitHub
      federation, installs the PostgreSQL client at the instance's major version,
      runs `scripts/db/cloud-sql/create-preview-db` (a `pg_dump` copy of
      `solpg_preview` without the rows of `session`, as built in task 1.3) and
      dbmate through `migration-url`, deploys with
      `-e DB_PROVIDER=cloud-sql -e CLOUD_SQL_DATABASE=<name>` over the Preview
      environment's `CLOUD_SQL_*` and `GCP_*` variables, and names the database
      in the PR comment; teardown runs `drop-preview-db`. Unset, the Neon path
      runs unchanged. The jobs run where `PREVIEW_REPOSITORY` names the
      repository and either `NEON_PROJECT_ID` is set or `PREVIEW_DB_PROVIDER` is
      `cloud-sql`. `preview-sweep.yml`: with `cloud-sql`, list the databases on
      `solpg-preview` matching `^solpg_preview_pr_[0-9]+$` through the proxy and
      drop those whose PR is closed or unlabelled, honouring `MIN_AGE_MINUTES`
      and `dry_run`, and never touching `solpg_preview` or `solpg_preview_br_*`; a
      database's age is the stamp `create-preview-db` writes as its comment
      (`copying:<epoch>`, then `created-at:<epoch>`), and one without a stamp
      is kept. Document the label, the variable, and the shared database in
      `client-v2/docs/preview-databases.md`, with `neon.md` kept for the Neon
      path and pointing to it, so the follow-up that removes Neon deletes it
      whole. Verify with a labelled PR whose comment names the database and
      whose preview URL answers `{ "enabled": true, "db": "ok" }` on
      `GET /api/sync`, whose database holds the shared rows and no
      `session` rows; removing the label drops the database; a dry-run sweep
      lists nothing for an open labelled PR and never lists `solpg_preview`.
      Depends on 1.2, 1.3, 2.1. Ticket to file.
- [ ] 2.3 `preview-shared-db.yml`, on push to `master` that changes
      `client-v2/db/migrations/**` and on `workflow_dispatch`, gated like
      `preview.yml` on `PREVIEW_REPOSITORY` and `PREVIEW_DB_PROVIDER=cloud-sql`:
      authenticate as `github-ci`, migrate `solpg_preview` through
      `scripts/db/cloud-sql/migration-url shared`. One concurrency group,
      never cancelled mid-run. Verify with a dispatch run that reports nothing
      to apply, and a merge adding a migration whose run applies it. Depends on 1.3,
      2.1. Ticket to file.
- [ ] 2.4 Migration notice in `preview.yml`: a job on `opened`, `reopened`,
      and `synchronize` of a PR from an integration branch (the only PRs with
      an automatic preview) without the `preview` label that lists the PR's
      files (the paginated REST API, `gh api --paginate`) and, when any is under
      `client-v2/db/migrations`, writes the preview comment through
      `.github/scripts/preview-comment.sh` naming `solpg_preview` and
      suggesting the label; on a PR from a fork, a `::warning::` and a step
      summary instead. Runs where `PREVIEW_REPOSITORY` names the repository
      and `PREVIEW_DB_PROVIDER` is `cloud-sql`: without the shared database
      there is nothing to warn about. Verify with a PR
      adding a migration (comment written), the same PR labelled (comment
      replaced by the deploy's), and a PR without one (no comment).
      Depends on 2.2. Ticket to file.
- [ ] 2.5 Vercel, by hand, written up in `client-v2/docs/cloud-sql.md` and
      `deploy-client-vercel.md`: on the Preview environment set
      `DB_PROVIDER=cloud-sql`, `CLOUD_SQL_INSTANCE`, `CLOUD_SQL_USER`, the
      `GCP_*` variables, and `CLOUD_SQL_DATABASE=solpg_preview`, and remove
      `DATABASE_URL`; on GitHub set `PREVIEW_DB_PROVIDER=cloud-sql` and the
      federation variables. Verify with an integration branch's Git-integration
      preview answering `{ "enabled": true, "db": "ok" }` on `GET /api/sync`.
      Depends on 2.1, 2.3. Ticket to file.
- [ ] 2.6 Add the gates that are not code to `client-v2/docs/cloud-sql.md`
      with their check commands: the `vercel-preview` and `github-ci` bindings
      conditioned on `solpg-preview`, and the reviewer checks that no workflow
      input or make variable sets `CLOUD_SQL_DATABASE` and that no
      `pull_request` workflow migrates `solpg_preview`. Verify by running each
      check command and pasting its output into the PR. Depends on 2.2, 2.3.
      Ticket to file.
- [ ] 2.7 Walk through every `(manual)` scenario of `client-v2-preview-database`
      and the preview scenarios of `client-v2-database-provider` on an
      integration branch's PR and on a PR labelled `preview`: sign-in, a project edited
      in one browser appearing in a second, a pushed migration applied to the
      labelled PR's database and noticed on the unlabelled one, the label
      removed. Record the results in that PR, with the cold and warm latency of
      `GET /api/sync` and the functions' region. Depends on 2.4, 2.5. Ticket to
      file.

## 3. Production on Cloud SQL

- [ ] 3.1 The production identity, by hand, written up in
      `client-v2/docs/cloud-sql.md`: a Workload Identity pool and provider
      trusting the Foundation Vercel team's issuer
      `https://oidc.vercel.com/<team>`, with `google.subject` mapped to
      `assertion.sub`, and the service account `vercel-production` bound to
      `environment:production` alone. Instance `solpg`: set `cloudsql.iam_authentication=on`,
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
      Vercel, the date) and the cold and warm latency of the first production
      deployment's `GET /api/sync` in `client-v2/docs/cloud-sql.md`. Verify with
      `gcloud sql instances describe solpg` showing the three settings and no
      authorised network, `\l solpg` showing `CONNECT` for the production user
      only, a direct `psql` to port 5432 refused, and `dbmate status` through
      `migration-url production` as an operator listing every migration
      pending on the empty `solpg`. That the application's own identity
      reaches `solpg` (the operator checks do not) is proven by 3.2's first
      production deployment, with the instance log naming the production IAM
      user. Depends on 1.2, 1.3. Ticket: HOO-2535.
- [ ] 3.2 Production on Cloud SQL from nothing, on the project's
      Vercel-generated production domain before any custom domain is
      attached: set `DB_PROVIDER=cloud-sql`, the `CLOUD_SQL_*` and `GCP_*`
      variables on Production, with no `DATABASE_*` variable; apply every
      migration to `solpg` with `migrate-production-db` as an operator, which
      reads those variables; make the first production deployment;
      `GET /api/sync` answers `{ "enabled": true, "db": "ok" }`;
      `migrate-production-db` names `solpg` and reports nothing to apply.
      `client-v2/docs/production-runbook.md` orders these steps. Update
      `deploy-client-vercel.md` ("Release checklist", "Conversation and
      project sync") and the root `CLAUDE.md` gotcha on the production
      database. Verify by `\dt` showing every table owned by the production
      user before the first deployment, the `GET /api/sync` body after it, and
      a sign-in and project edit on the generated domain writing a row to
      `solpg`, all recorded on the ticket. Depends on 3.1. Ticket to file.
- [ ] 3.3 Add a `smoke` job to `client-v2.yml` on push to `master` that waits
      for the Vercel deployment of the pushed commit and fails unless its
      `GET /api/sync` answers `{ "enabled": true, "db": "ok" }`, naming the URL
      and the body on failure. Verify with one green run after a push and one
      red run against a deployment whose `SYNC_ENABLED` is off. Depends on 3.2.
      Ticket: HOO-2536.
- [ ] 3.4 Finish `client-v2/docs/cloud-sql.md` as the guide for maintainers of
      `solana-foundation/solana-playground`: a design section (identities and
      the instances they reach, the four gates, which workflow creates,
      migrates, and drops which database, who migrates production), then the
      setup steps in order for Google Cloud, Vercel, and GitHub, adding an
      operator, and production's setup from nothing, with every value
      specific to this deployment as a placeholder. Link it from
      `deploy-client-vercel.md` and `preview-databases.md`. Verify by the
      four `(manual)` scenarios of "A maintainer guide sets the pipeline up
      from nothing" in `client-v2-production-database`, checked on the PR by
      someone who did not run tasks 2.1, 2.5, and 3.1. Depends on 2.6, 3.2. Ticket
      to file.
- [ ] 3.5 Release on the custom domain, once the run on the Vercel-generated
      domain is finished: set `AUTH_BASE_URL` and the GitHub OAuth app's
      callback URL to the custom domain; attach the domain to the Production
      environment and redeploy. `solpg` is not created again: the test
      accounts, sessions, and rows written on the generated domain stay in it
      (decided 2026-11-10). Verify by 3.2's checks passing on the custom
      domain, recorded on the ticket. Depends on 3.2. Ticket: HOO-2537.
