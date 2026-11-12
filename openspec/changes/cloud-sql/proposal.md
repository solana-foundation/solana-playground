# Proposal

## Why

Production conversation and project data sits in a Neon database outside the
team's Google Cloud project, which already holds an empty Cloud SQL instance,
`solpg`, and the App Engine build server. The team wants production data in its
own project, without opening Postgres's port to the internet and without a
stored database password or service-account key. Neon cannot act as a
connection pooler for a database it does not host and offers no Google Cloud
region, so it cannot be the way there.

The project also moves to `solana-foundation`'s Vercel project for good. It
deploys a preview of every integration branch through its Git integration (a
ticket branch's PR gets one only through the `preview` label), and there is no
preview Neon project behind it, so previews need a Cloud SQL home as well.

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
- **Previews on Cloud SQL.** A second, small instance, `solpg-preview`,
  serves every preview. Each preview from the Git integration, built for
  integration branches only, reads one shared database there, `solpg_preview`, named by the Preview environment's
  variables. A PR labelled `preview` gets a database of its own,
  `solpg_preview_pr_<number>`, a copy of `solpg_preview` without its
  sessions, so the PR's migrations run on top of the rows previews have
  written, as a migration runs on production's; the label works only while the repository
  variable `PREVIEW_DB_PROVIDER` is `cloud-sql`, and while it is unset the
  label still cuts a Neon branch, until a follow-up removes Neon. Previews move
  to Cloud SQL after production does, once the Breakpoint launch (11 Nov 2026)
  has shipped; until then they stay on Neon.
- **A PR that adds migrations is told so.** The shared database carries only
  the migrations on `master`, so a PR that changes `client-v2/db/migrations`
  gets a comment saying its automatic preview runs against a schema without
  them, and suggesting the `preview` label.
- **Previews never reach the production database.** Four gates, each enforced
  by a different party: the federation bindings (neither a preview
  deployment's token nor a CI job's maps to a service account with a role on
  `solpg`), Postgres grants on `solpg` (`CONNECT` revoked from `PUBLIC`), the
  `cloud-sql` provider's refusal to open database `solpg` outside the
  Production environment, and a preview database name the workflows derive
  from the PR number with no input to override.
- **Migrations.** A labelled PR's database is migrated by `preview.yml` on
  every deploy, as today. `solpg_preview` is migrated by a workflow on push to `master`, never from a PR's run, since a
  PR's run executes the PR's code. `migrate-production-db` stays a person's step and migrates the one
  database production reads, chosen by Production's `DB_PROVIDER`: `solpg`
  on Cloud SQL, through the Cloud SQL Auth Proxy as the operator's own
  Google identity. No CI identity holds a role on `solpg`. Nothing migrates
  from a serverless function, as before.
- **Production from nothing.** The Foundation's production has no earlier
  database, so no data moves and nothing is frozen: Production's variables
  name `solpg`, `solpg` is migrated from zero, and the first production
  deployment, on the project's Vercel-generated domain, reports `db: "ok"` on
  `/api/sync`. Vercel's Instant Rollback rolls back a bad deployment; it does
  not undo a migration. The custom domain is attached once the run on the
  generated domain is finished, and `solpg` keeps the rows written during it.
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
- `client-v2-preview-database`: the shared preview database every preview
  reads and its migration from `master`; the notice to a PR that adds
  migrations; a labelled PR's own database, on Cloud SQL or, until Neon is
  removed, on Neon; its name, its lifetime, its migration, its teardown, and
  the sweep.
- `client-v2-production-database`: production's database on Cloud SQL, the
  identity it connects with, the instance settings that keep Postgres's port
  closed, who migrates it and where, its setup from nothing and the rollback
  of a deployment, the release on
  the custom domain, and the maintainer guide that sets the pipeline up from
  nothing.

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
  `.github/workflows/preview-sweep.yml`,
  `.github/workflows/preview-shared-db.yml` (new, migrates the shared preview
  database on push to `master`), `.github/workflows/client-v2.yml`
  (a production smoke job on push to `master`).
- Dependencies: `@google-cloud/cloud-sql-connector`, `google-auth-library`,
  `@vercel/oidc` in `client-v2/package.json`; `cloud-sql-proxy` on the runner
  and on a laptop that migrates production.
- Google Cloud, by hand and documented: instance `solpg-preview`, its shared
  database `solpg_preview`; a Workload Identity Federation pool
  and provider trusting Vercel's issuer, with one service account per Vercel
  environment; a pool and provider trusting GitHub Actions for the preview
  jobs, with a role on `solpg-preview` only, since `cicd.yml` is the only
  workflow that reaches Google Cloud today and it does so with a stored JSON
  key, which this change does not reuse; IAM database users for the
  applications, CI, and the operators who migrate production; the `solpg`
  instance flags.
- GitHub: the repository variable `PREVIEW_DB_PROVIDER`, and the federation
  variables the preview workflows read.
- Vercel: `DB_PROVIDER`, `CLOUD_SQL_INSTANCE`, `CLOUD_SQL_DATABASE`,
  `CLOUD_SQL_USER`, and the `GCP_*` federation variables per environment;
  `DATABASE_URL` removed from Production; the Preview environment names
  `solpg_preview`.
- Docs: `client-v2/docs/cloud-sql.md` (new), a guide for maintainers of
  `solana-foundation/solana-playground`: the design of the pipeline, then
  every step to set it up in Google Cloud, Vercel, and GitHub, production's
  among them; `client-v2/docs/production-runbook.md` (new), which orders
  production's steps for the Foundation; `client-v2/docs/neon.md`,
  `client-v2/docs/deploy-client-vercel.md`, the root `CLAUDE.md` "Gotchas"
  entry on the production database.
- User-visible: production starts on an empty `solpg`, and the accounts and
  rows the team writes on the generated domain are still there after the
  release. An unlabelled preview reads and writes the shared `solpg_preview`, so
  it sees rows written from every other PR's preview. A preview labelled
  `preview` starts with the rows of `solpg_preview` at its first deploy,
  without anyone's sign-in: sessions are not copied. Otherwise nothing changes for a user.
- Out of scope: a query or repository abstraction over SQL (both providers are
  Postgres); removing the Neon scripts, the Neon path of the preview
  workflows, `client-v2/docs/neon.md`, and the Neon projects, which is a
  follow-up; a copy of production
  data into Cloud SQL previews; an external connection pooler (the Enterprise
  edition of `solpg` has no managed pooling, and the sizing rule in
  `client-v2-production-database` replaces it until Cloud SQL reports
  exhaustion); migrating the Rust build server's MongoDB; the Vercel function
  region, which is a project setting; copying production's Neon data into
  `solpg`, and the write freeze such a copy would need, since production has
  no users yet.
