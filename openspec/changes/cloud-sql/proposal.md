# Proposal

## Why

Production conversation and project data sits in a Neon database outside the
team's Google Cloud project `analytics-324114`, which already holds an empty
Cloud SQL instance, `solpg`, and the App Engine build server. The team wants
production data in its own project, without opening Postgres's port to the
internet and without a stored database password or service-account key. Neon
cannot act as a connection pooler for a database it does not host and offers no
Google Cloud region, so it cannot be the way there.

## What Changes

- **A database provider layer.** `DB_PROVIDER` selects how the serverless
  functions obtain a Postgres pool: `url` (a connection string: Neon, the
  compose container, the CI service container) or `cloud-sql` (the Cloud SQL
  Node.js Connector, Google's connector front end on the instance, IAM
  database authentication, no connection string). Every query stays as it
  is: both providers are Postgres. The same layer owns provisioning, one script
  set per provider, which the preview workflows and `Makefile.vercel` call by
  generic names: create and drop a preview database, and the URL dbmate
  migrates through.
- **Production on Cloud SQL.** The Production environment on Vercel connects to
  database `solpg` on instance `solpg` through the `cloud-sql` provider,
  authenticated by Vercel's OIDC token exchanged for a Google service account
  through Workload Identity Federation. `DATABASE_URL` leaves the Production
  environment. The instance gains IAM authentication, connector enforcement,
  and encrypted-only connections; authorised networks stay empty.
- **Previews stay on Neon by default.** A PR labelled `preview` keeps getting
  a Neon branch. A PR labelled `preview:cloud-sql` instead gets its own
  database `solpg_preview_<id>` on a second, small Cloud SQL instance,
  `solpg-preview`, deployed with `DB_PROVIDER=cloud-sql`. That is how the
  production connection path is exercised on a deployment before production
  depends on it, and how it is re-tested after.
- **Previews never reach the production database.** Four gates, each enforced
  by a different party: the federation binding (a preview deployment's token
  maps to a service account with no role on `solpg`), Postgres grants on
  `solpg` (`CONNECT` revoked from `PUBLIC`), the `cloud-sql` provider's refusal
  to open database `solpg` outside the Production environment, and a preview
  database name the workflows derive from the branch with no input to override.
- **Migrations.** `migrate-production-db` migrates two targets: `solpg` on
  Cloud SQL, through the Cloud SQL Auth Proxy with federated credentials, and
  Neon `main`, which stays the parent of Neon preview branches. Nothing
  migrates from a serverless function, as before.
- **Cutover.** `SYNC_ENABLED=false` freezes writes, the Neon data is restored
  into `solpg`, the Production environment switches provider, `/api/sync`
  reports `db: "ok"`, and `SYNC_ENABLED=true` reopens writes. Rollback before
  the last step is restoring `DATABASE_URL`.
- **Telemetry.** The change touches `features/persistence` and
  `features/auth` on their server side only (`.mjs` modules the functions
  load). It adds, renames, and removes no telemetry event. A provider that
  cannot connect surfaces as `/api/sync` answering `db: "unreachable"`, which
  the client already handles by staying local.

## Capabilities

### New Capabilities

- `client-v2-database-provider`: how the serverless functions obtain their
  Postgres pool, selected by `DB_PROVIDER`; the `url` and `cloud-sql`
  providers; the refusal that keeps a non-production deployment off the
  production database; how `/api/sync` reports the result.
- `client-v2-preview-database`: a preview deployment's own database, on Neon
  or on Cloud SQL by PR label; its name, its lifetime, its migration, its
  teardown, and the sweep.
- `client-v2-production-database`: production's database on Cloud SQL, the
  identity it connects with, the instance settings that keep Postgres's port
  closed, the two migration targets, and the cutover and rollback.

### Modified Capabilities

None. `assistant-own-key`, `client-v2-build`, `client-v2-editor-crates`,
`client-v2-unit-tests`, and `project-conflict-resolution` say nothing about
how the functions reach Postgres.

## Impact

- Code: `client-v2/src/shared/config/server-env.mjs` (`DB_PROVIDER` and the
  Cloud SQL variables), `client-v2/src/features/persistence/model/db.mjs`
  (`getPool` turns async and delegates to a provider),
  `client-v2/src/features/persistence/model/providers/` (new),
  `client-v2/src/features/auth/model/auth.mjs` (`getAuth` awaits the pool),
  `client-v2/api/auth.mjs`, `client-v2/src/features/persistence/model/conversations.mjs`,
  `client-v2/scripts/db/` (new, provisioning per provider),
  `client-v2/Makefile.vercel`, `.github/workflows/preview.yml`,
  `.github/workflows/preview-sweep.yml`, `.github/workflows/client-v2.yml`
  (a production smoke job on push to `master`).
- Dependencies: `@google-cloud/cloud-sql-connector`, `google-auth-library`,
  `@vercel/oidc` in `client-v2/package.json`; `cloud-sql-proxy` on the runner
  and on a laptop that migrates production.
- Google Cloud, by hand and documented: instance `solpg-preview`; a Workload
  Identity Federation pool and provider trusting Vercel's issuer, with one
  service account per Vercel environment; a pool and provider trusting GitHub
  Actions for the preview and migration jobs, since `cicd.yml` is the only
  workflow that reaches Google Cloud today and it does so with a stored JSON
  key, which this change does not reuse; IAM database users; the `solpg`
  instance flags.
- Vercel: `DB_PROVIDER`, `CLOUD_SQL_INSTANCE`, `CLOUD_SQL_DATABASE`,
  `CLOUD_SQL_USER`, and the `GCP_*` federation variables per environment;
  `DATABASE_URL` removed from Production.
- Docs: `client-v2/docs/cloud-sql.md` (new), `client-v2/docs/neon.md`,
  `client-v2/docs/deploy-client-vercel.md`, the root `CLAUDE.md` "Gotchas"
  entry on the production database.
- User-visible: during the cutover's write freeze, sync is off and the app is
  local-only, as it is on any deployment without a database; a preview
  labelled `preview:cloud-sql` starts with an empty database instead of a copy
  of production's rows. Otherwise nothing changes for a user.
- Out of scope: a query or repository abstraction over SQL (both providers are
  Postgres); moving the default `preview` label off Neon; a copy of production
  data into Cloud SQL previews; an external connection pooler (the Enterprise
  edition of `solpg` has no managed pooling, and the sizing rule in
  `client-v2-production-database` replaces it until Cloud SQL reports
  exhaustion); migrating the Rust build server's MongoDB; the Vercel function
  region, which is a project setting.
