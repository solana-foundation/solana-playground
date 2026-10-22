# Design

## Context

See `proposal.md`, "Why". The code that reaches Postgres is one module,
`client-v2/src/features/persistence/model/db.mjs`: `getPool()` builds a
`pg.Pool` from `DATABASE_URL` once, synchronously, and `query`, `transaction`,
`conversations.mjs`, and `auth.mjs` (`betterAuth({ database: pool })`) read it.
`GET /api/sync` runs `select 1` on it and answers one of three shapes. The
preview tooling is keyed by git branch: `.github/scripts/neon.sh`
(`ensure`, `uri`, `delete`, `list`), `scripts/neon-preview-branch.sh`, and the
`Makefile.vercel` targets. The only workflow that reaches Google Cloud is
`cicd.yml`, through a stored JSON key.

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

## Decisions

- **`getPool()` becomes async and delegates to a provider.** The Cloud SQL
  connector's `getOptions()` resolves an ephemeral client certificate and the
  instance's address, which takes a network round trip, so a pool cannot be
  built synchronously. `getPool()` memoises the promise; `query`,
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
- **The refusal gate reads `VERCEL_ENV`.** Vercel sets it; a deployment's own
  variables cannot override a system variable. The gate compares
  `CLOUD_SQL_DATABASE` to the literal `solpg` and runs before the token
  exchange, so a refused preview spends nothing and leaves no trace on the
  instance.
- **One service account per Vercel environment, on separate instances.**
  `vercel-production` (subject `environment:production`) holds Cloud SQL
  Client and Instance User on `solpg`; `vercel-preview` (subject
  `environment:preview`) holds them on `solpg-preview` only. Separate
  instances rather than separate databases on `solpg`: a role on an instance
  grants a connection to the instance, and a preview migration or a runaway
  query on the production instance shares its CPU. A small zonal
  `solpg-preview` costs a fraction of `solpg`.
- **Preview databases are named by branch, with underscores.** Neon branches,
  laptop deploys, and the sweep are all keyed by git branch, so one key fits
  both providers. Postgres treats `-` as an operator in an unquoted
  identifier, so the name uses `_`; identifiers cap at 63 bytes, so a long
  branch is cut and gets eight hex characters of its SHA-256, which also keeps
  `fix/a-b` and `fix/a_b` apart. One module, `scripts/db/preview-name.mjs`,
  computes the name for the workflows, the make targets, and the scripts.
- **Provisioning is one script set per provider under `scripts/db/<provider>/`.**
  `create-preview-db <branch>`, `drop-preview-db <branch>`, and
  `migration-url <branch | production>`. The `url` set wraps `neon.sh` and
  `neon-preview-branch.sh`; the `cloud-sql` set runs the Cloud SQL Auth Proxy,
  `CREATE DATABASE ... OWNER` as the CI IAM user, and prints
  `postgres://<user>@127.0.0.1:<port>/<database>?sslmode=disable` for dbmate
  (the proxy carries the TLS). `preview.yml`, `preview-sweep.yml`, and
  `Makefile.vercel` call the generic names and pass `DB_PROVIDER`.
- **GitHub Actions reaches Google Cloud through its own federation.** A second
  Workload Identity pool provider trusts GitHub's OIDC issuer for this
  repository, and `google-github-actions/auth` exchanges the job's token for a
  CI service account that holds Cloud SQL Client and Instance User on
  `solpg-preview` and, for the migration job, on `solpg`. `cicd.yml`'s stored
  JSON key is not reused and is not touched by this change.
- **Ownership on a preview database.** The CI IAM user creates the database
  with `OWNER` set to the preview IAM user and is granted that role, so
  migrations run by CI create tables the preview user owns and the app needs
  no per-table grant. On `solpg`, the migration user is a member of the
  production user's role for the same reason.
- **Migrations reach two targets.** `migrate-production-db` migrates `solpg`
  through the proxy and Neon `main` through its unpooled URL, prints both
  hosts and both pending lists, and asks once. Neon `main` stays the parent
  of Neon preview branches, so a migration missing there would be replayed by
  every later preview.
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
  memoised at module scope so a warm instance pays once.
- [Neon `main` drifts from production's data after the cutover] → accepted:
  previews need the schema and some rows, not current data. The migration job
  keeps its schema current.
- [`preview-sweep.yml` lists databases on an instance, which needs a
  connection where the Neon sweep needed only an API key] → the sweep runs
  the proxy under the CI federation; a sweep that cannot connect fails and
  deletes nothing, as the Neon sweep does on an API error.
- [Two labelled PRs with head branches that sanitise alike] → the hash suffix
  applies whenever the sanitised names collide, not only when the name is cut.

## Migration Plan

1. Provider layer merged; every deployment still on `DB_PROVIDER` unset, so
   `url`. No behaviour change.
2. Google Cloud set up by hand and documented in `client-v2/docs/cloud-sql.md`:
   `solpg-preview`, the two federation pools and providers, the three service
   accounts, the IAM database users, the instance flags on both instances.
3. A PR labelled `preview:cloud-sql` deploys against `solpg-preview`;
   `GET /api/sync` answers `db: "ok"`; sign-in and a two-browser project edit
   work. Recorded in that PR.
4. `migrate-production-db` rewritten; `solpg` database created on instance
   `solpg`; `CONNECT` revoked from `PUBLIC`; all migrations applied to the
   empty database.
5. Cutover, in one sitting: `SYNC_ENABLED=false` on Production, redeploy;
   `pg_dump` Neon `main`, `pg_restore` into `solpg` through the proxy; row
   counts compared; `DB_PROVIDER=cloud-sql` and the `CLOUD_SQL_*` and `GCP_*`
   variables set on Production, `DATABASE_URL` removed; redeploy;
   `GET /api/sync` answers `db: "ok"`; `SYNC_ENABLED=true`, redeploy.
6. Rollback before step 5's last redeploy: restore `DATABASE_URL` and
   `DB_PROVIDER=url` on Production and redeploy. Nothing was written since the
   freeze, so Neon `main` is current.

## Open Questions

- Which Vercel region the functions run in. `solpg` is in `us-central1`; the
  nearest Vercel region is a project setting read from the dashboard, and the
  latency difference is unmeasured. It changes no spec or task.
- Whether the CI IAM user and the application IAM user on `solpg` should be
  one user. The design keeps them separate with role membership; collapsing
  them removes one grant and one principal and changes no behaviour.
