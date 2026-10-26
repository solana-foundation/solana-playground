# Design

## Context

See `proposal.md`, "Why". The code that reaches Postgres is one module,
`client-v2/src/features/persistence/model/db.mjs`: `getPool()` builds a
`pg.Pool` from `DATABASE_URL` once, synchronously, and `query`, `transaction`,
`conversations.mjs`, and `auth.mjs` (`betterAuth({ database: pool })`) read it.
`GET /api/sync` runs `select 1` on it and answers one of three shapes. The
preview tooling is `.github/scripts/neon.sh` (`ensure`, `uri`, `delete`,
`list`), `scripts/neon-preview-branch.sh`, and the `Makefile.vercel` targets: a
labelled PR gets the Neon branch `preview/pr-<number>`, a laptop deploy gets
`preview/<git-branch>`, both cut from `main` of the preview Neon project, which
is separate from production's Neon project. The only workflow that reaches
Google Cloud is `cicd.yml`, through a stored JSON key.

Verified 2026-10-22: with no change to the instance,
`cloud-sql-proxy --gcloud-auth analytics-324114:us-central1:solpg` reached
Postgres on `solpg` from a laptop, through the connector front end on port
3307, and `psql` was asked for a password. Instance `solpg`: Postgres 17,
Enterprise edition, `db-custom-4-16384`, regional, 100 GB, public IP, no
authorised network, `connectorEnforcement: NOT_REQUIRED`,
`sslMode: ALLOW_UNENCRYPTED_AND_ENCRYPTED`, IAM authentication off, one
database `postgres`, one built-in user `postgres`.

## Goals / Non-Goals

**Goals:**

- Nothing above `db.mjs` knows which provider is behind the pool.
- The production connection path runs on a real deployment, under the Preview
  identity, before production depends on it.
- Each gate between a preview and the production database is enforced by a
  different party, so one mistake is not enough.

**Non-Goals:**

- A query layer. Both providers are Postgres; `pg` and every statement stay.
- Moving the default `preview` label off Neon.
- Keeping the `solpg` and `solpg-preview` instances identical in size.
- Migrating production from CI. It stays a person's step, as it is today.

## Decisions

- **`getPool()` becomes async and delegates to a provider.** The Cloud SQL
  connector's `getOptions()` resolves an ephemeral client certificate and the
  instance's address, which takes a network round trip, so a pool cannot be
  built synchronously. `getPool()` memoises the promise, and drops it when it
  rejects, so one failed token exchange or certificate fetch is retried by the
  next request instead of failing every query for the life of a warm
  instance; `query`,
  `transaction`, and `conversations.mjs` await it; `getAuth()` awaits it and
  turns async, and `api/auth.mjs` and `readSession` await `getAuth()`. The
  alternative, a synchronous `pg.Pool` with a `stream` factory that connects
  lazily, would hide the connector's first failure inside a socket and leave
  `/api/sync` reporting a pool that never worked.
- **Selection by `DB_PROVIDER`, not by which variables are set.** Both
  providers could be inferred from `DATABASE_URL` or `CLOUD_SQL_INSTANCE`
  being present, but a deployment that inherits one variable from the project
  and gets another per deploy would then pick a provider nobody chose. An
  explicit value is reviewable, and an unknown value fails closed.
- **Providers live in `features/persistence/model/providers/<name>.mjs`.**
  Each exports `isConfigured(env)` and `createPool(env)`; `db.mjs` picks one by
  `DB_PROVIDER`. `server-env.mjs` grows `databaseEnv()` with `DB_PROVIDER`,
  the `CLOUD_SQL_*` variables, `VERCEL_ENV`, and the `GCP_*` federation
  variables, read at call time as every getter there is.
- **The `cloud-sql` provider's identity is Vercel's OIDC token.**
  `google-auth-library`'s `ExternalAccountClient` takes a
  `subject_token_supplier` whose `getSubjectToken` is `@vercel/oidc`'s
  `getVercelOidcToken`, exchanges it at Google's STS for the service account
  named by `GCP_SERVICE_ACCOUNT_EMAIL`, and the connector takes that client
  with `authType: "IAM"`. No key, no password. The alternative, Application
  Default Credentials from a key file, is what the team has ruled out.
- **The refusal gate reads `VERCEL_ENV`.** Vercel sets it, and the gate
  assumes a deployment's own variables cannot override it (see Open
  Questions). The gate compares `CLOUD_SQL_DATABASE` to the literal `solpg`
  and runs before the token exchange, so a refused preview spends nothing and
  leaves no trace on the instance.
- **One service account per Vercel environment, on separate instances.**
  `vercel-production` (subject `environment:production`) holds Cloud SQL
  Client and Instance User on `solpg`; `vercel-preview` (subject
  `environment:preview`) holds them on `solpg-preview` only. Separate
  instances rather than separate databases on `solpg`: a role on an instance
  grants a connection to the instance, and a preview migration or a runaway
  query on the production instance shares its CPU. A small zonal
  `solpg-preview` costs a fraction of `solpg`.
- **A Cloud SQL preview database is cloned from a template.** Cloud SQL has no
  copy-on-write branches, but Postgres copies a database at creation:
  `CREATE DATABASE <name> TEMPLATE solpg_preview_base OWNER <preview user>`.
  The clone carries the base's schema, rows, and `schema_migrations`, so dbmate
  applies only the migrations the base lacks, as on a Neon branch. The base is
  marked `IS_TEMPLATE true` and `ALLOW_CONNECTIONS false`, because a clone
  fails while any session is connected to its template; the script that
  migrates the base lifts `ALLOW_CONNECTIONS` for the run and restores it. It
  holds preview data only, never a copy of production's, for the reason
  `client-v2/docs/neon.md` gives for the separate preview Neon project. The
  copy is a full one, not copy-on-write, which is cheap at preview sizes. The
  alternative, an empty database migrated from zero, leaves every preview
  without rows and replays every migration on every new preview.
- **Tables are owned by the application's user.** In Postgres the role that
  creates a table owns it; membership in another role does not change that.
  So every migration connection sets its session role to the user the
  application connects as (`options=-c role=<user>` in the URL dbmate reads),
  on `solpg-preview` and on `solpg`. The application then owns every table and
  needs no per-table grant, and the base's tables, copied as they are into each
  clone, already belong to the preview user.
- **Preview databases are named by PR number.** A labelled PR's database is
  `solpg_preview_pr_<number>`, as its Neon branch is `preview/pr-<number>`: no
  sanitising, no length limit to meet, no collision. A laptop deploy has no PR,
  so its database is named after the git branch, as its Neon branch is:
  `solpg_preview_br_<id>`, where `<id>` is the branch with every character
  outside `[a-z0-9_]` replaced by `_` (Postgres treats `-` as an operator in an
  unquoted identifier), cut to fit 63 bytes, and suffixed with eight hex
  characters of the branch's SHA-256 so `fix/a-b` and `fix/a_b` stay apart.
  The prefixes differ so a branch called `pr_12` cannot take PR 12's database.
  One module, `scripts/db/preview-name.mjs`, computes both names for the
  workflows, the make targets, and the scripts.
- **Provisioning is one script set per provider under `scripts/db/<provider>/`.**
  `create-preview-db`, `drop-preview-db`, and `migration-url`, each taking
  `--pr <number>` or `--branch <name>` and never a database name, and
  `migration-url production`. The `url` set wraps `neon.sh` and
  `neon-preview-branch.sh`; the `cloud-sql` set runs the Cloud SQL Auth Proxy,
  clones the template as the CI IAM user, and prints
  `postgres://<user>@127.0.0.1:<port>/<database>?sslmode=disable&options=-c%20role%3D<app user>`
  for dbmate (the proxy carries the TLS). The `cloud-sql` set also has
  `migrate-preview-base`. `preview.yml`, `preview-sweep.yml`, and
  `Makefile.vercel` call the generic names and pass `DB_PROVIDER`.
- **GitHub Actions reaches `solpg-preview` only.** A second Workload Identity
  pool provider trusts GitHub's OIDC issuer, with an attribute condition
  naming this repository, and `google-github-actions/auth` exchanges the job's
  token for `github-ci`, which holds Cloud SQL Client and Instance User on
  `solpg-preview`, `CREATEDB`, and membership of the preview user's role. It
  holds nothing on `solpg`: `preview.yml` runs on `pull_request`, which reads
  the workflow from the PR's merge commit, so anyone who can push a branch can
  change what the job does with its identity. `cicd.yml`'s stored JSON key is
  not reused and is not touched by this change.
- **Production migrations run as a person.** `migrate-production-db` stays a
  make target run from a laptop. On Cloud SQL it runs the proxy with the
  operator's own Google credentials (`--auto-iam-authn`); each operator is an
  IAM database user on `solpg`, a member of the production user's role, and
  sets that role per the ownership decision above. Operators are named in
  `client-v2/docs/cloud-sql.md`; adding one is an IAM grant and a database
  user, not a shared secret.
- **A production migration has one target: the database production reads.**
  `migrate-production-db` already pulls the Production environment's
  variables. While Production's `DB_PROVIDER` is `url` or unset, it migrates
  the production Neon project through its unpooled URL, as today; once it is
  `cloud-sql`, it migrates `solpg` through the proxy and no longer reaches
  Neon. No database is migrated that production does not read: the preview
  Neon project's `main` and `solpg_preview_base` are preview infrastructure,
  and the preview that clones them applies whatever they lack.
- **The cutover copies no data.** Production has no users yet (confirmed with
  the team, 2026-10-27), so the production Neon project holds only test rows
  and nothing is moved from it. `solpg` is migrated from zero through
  `migration-url production` as an operator, under the production user's
  role, while Production still reads Neon; then Production's variables
  switch. With nothing copied there is no window in which two databases hold
  the same data, so no write freeze: `SYNC_ENABLED` stays `true`. The
  alternative, `pg_dump` and `pg_restore` behind a freeze, protects data that
  does not exist; and a freeze on `SYNC_ENABLED` alone would not hold,
  because Better Auth writes sessions on sign-in and on session refresh. A
  deployment that already has users needs that copy, and this change does
  not specify it.
- **The smoke check is `GET /api/sync`, not a new route.** It already runs
  `select 1` and already hides detail. A job in `client-v2.yml` on push to
  `master` waits for the Vercel deployment of that commit (the Vercel CLI
  lists deployments by `githubCommitSha`) and asserts the body. `cicd.yml` is
  the wrong place: it deploys App Engine from a tag.

## Risks / Trade-offs

- [The production path runs on no deployment until someone labels a PR
  `preview:cloud-sql`] → task 2.4 labels one and records the result before
  the cutover task may start; the smoke job catches a regression after.
- [Each function instance holds its own pool, and Cloud SQL Enterprise has no
  managed pooler] → `max` stays small, `idleTimeoutMillis` short, and the
  sizing rule in `client-v2-production-database` is recorded with the
  concurrent instance count read from Vercel; an external pooler is added only
  when Cloud SQL reports exhaustion.
- [The first connection of a cold instance pays the token exchange and the
  certificate fetch] → the connector caches both per instance; the pool is
  memoised at module scope so a warm instance pays once. Task 2.4 records the
  cold and warm latency of `GET /api/sync` so the cost is a number before the
  cutover.
- [`solpg_preview_base` falls behind `client-v2/db/migrations`] → accepted:
  each clone applies what the base lacks. `migrate-preview-base` brings it
  forward when the replay grows long.
- [A clone fails while a session is connected to the base] →
  `ALLOW_CONNECTIONS false` on the base outside `migrate-preview-base`, and
  `create-preview-db` reports the failure on the PR like any failed step.
- [`preview-sweep.yml` lists databases on an instance, which needs a
  connection where the Neon sweep needed only an API key] → the sweep runs
  the proxy under the CI federation; a sweep that cannot connect fails and
  deletes nothing, as the Neon sweep does on an API error.
- [The production Neon project outlives the cutover] → it is the rollback:
  nothing writes to it once Production reads `solpg`, so switching back finds
  it as it was. Deleting it is a later decision, outside this change.
- [Users arrive before the cutover] → the cutover then copies data it no
  longer specifies; task 3.2 starts by confirming with the team that
  production still has no users, and stops if it has.

## Migration Plan

1. Provider layer merged; every deployment still on `DB_PROVIDER` unset, so
   `url`. No behaviour change.
2. Google Cloud set up by hand and documented in `client-v2/docs/cloud-sql.md`:
   `solpg-preview` and its `solpg_preview_base`, the two federation pools and
   providers, the three service accounts, the IAM database users, the instance
   flags on both instances.
3. A PR labelled `preview:cloud-sql` deploys against `solpg-preview`;
   `GET /api/sync` answers `db: "ok"`; sign-in and a two-browser project edit
   work. Recorded in that PR.
4. `migrate-production-db` rewritten; `vercel-production` granted Cloud SQL
   Client and Instance User on `solpg` and added as its IAM database user;
   empty database `solpg` created on instance `solpg`, owned by that user;
   `CONNECT` revoked from `PUBLIC`; the operators' IAM users added; a staged
   production deployment (`--prod --skip-domain`, no domain, sync off) answers
   `db: "ok"` on `GET /api/sync`, which proves the production identity's whole
   path before any data depends on it; `dbmate status` through the proxy as an
   operator lists every migration pending.
5. Cutover, in one sitting, with sync on throughout: confirm production still
   has no users; apply every migration to `solpg` through
   `migration-url production` as an operator; `DB_PROVIDER=cloud-sql` and the
   `CLOUD_SQL_*` and `GCP_*` variables set on Production, `DATABASE_URL` and
   `DATABASE_URL_UNPOOLED` removed; redeploy; `GET /api/sync` answers
   `{ "enabled": true, "db": "ok" }`; `migrate-production-db` names `solpg`
   and reports nothing to apply; a sign-in and a project edit on the
   production domain land in `solpg`.
6. Rollback at any point after the switch: restore `DATABASE_URL` and
   `DB_PROVIDER=url` on Production and redeploy. The production Neon project
   was not written since the switch, so it is as it was; rows written to
   `solpg` meanwhile are test data.

## Open Questions

- Which Vercel region the functions run in. `solpg` is in `us-central1`; the
  nearest Vercel region is a project setting read from the dashboard, and the
  latency difference is unmeasured. It changes no spec or task.
- Who the operators are: the people who hold an IAM database user on `solpg`
  and may run `migrate-production-db`.
- Whether Vercel lets a project variable named `VERCEL_ENV` shadow the system
  one. The refusal gate assumes not. If it can, that gate is weaker than the
  spec states, and the other three still hold.
