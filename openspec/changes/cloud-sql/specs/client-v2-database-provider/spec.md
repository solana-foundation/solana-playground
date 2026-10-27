# Spec Delta

## Purpose

How the serverless functions obtain their Postgres connection pool: one
provider selected by the deployment, so a query never knows whether a
connection string or Google's Cloud SQL connector is behind it, and a
deployment outside production can never open the production database.

## ADDED Requirements

### Requirement: One variable selects the database provider

The functions SHALL read `DB_PROVIDER` and obtain their pool from the named
provider: `url` or `cloud-sql`. Unset, `DB_PROVIDER` SHALL mean `url`. Any
other value SHALL make every database-backed route fail with a configuration
error that names the value, and SHALL NOT fall back to another provider.

#### Scenario: An unset provider means a connection string (manual)

- **WHEN** a deployment sets `DATABASE_URL` and no `DB_PROVIDER`
- **THEN** the functions connect through `DATABASE_URL`, as every deployment
  did before `DB_PROVIDER` existed

Checked by the unit test "defaults to the url provider" in
`client-v2/src/features/persistence/model/db.test.mjs`.

#### Scenario: A misspelled provider fails closed (manual)

- **WHEN** a deployment sets `DB_PROVIDER=cloudsql` with `DATABASE_URL` set
- **THEN** `GET /api/sync` answers `{ "enabled": false, "db": "unreachable" }`,
  and the functions open no connection through `DATABASE_URL`

Checked by the unit test "refuses an unknown provider rather than falling back"
in `client-v2/src/features/persistence/model/db.test.mjs`.

### Requirement: The url provider connects through a connection string

With `DB_PROVIDER=url`, the functions SHALL connect through `DATABASE_URL`
over TLS with the server certificate verified, unless the URL itself names an
`sslmode`, which SHALL win. Without `DATABASE_URL` the provider SHALL report
itself unconfigured, and sync SHALL be off.

#### Scenario: A URL that says nothing about SSL is encrypted and verified (manual)

- **WHEN** `DATABASE_URL` names no `sslmode`
- **THEN** the pool verifies the server certificate, and a server without TLS
  is refused rather than connected to in the clear

Checked by the unit test "requires a verified TLS connection unless the URL
says otherwise" in `client-v2/src/features/persistence/model/db.test.mjs`.

#### Scenario: No connection string, no sync (manual)

- **WHEN** `DATABASE_URL` is unset under the `url` provider
- **THEN** `GET /api/sync` answers `{ "enabled": false, "db": "unconfigured" }`
  and the client stays local

Checked by the unit test "reports unconfigured when DATABASE_URL is absent" in
`client-v2/src/features/persistence/model/db.test.mjs`.

### Requirement: The cloud-sql provider connects through Google's connector front end

With `DB_PROVIDER=cloud-sql`, the functions SHALL connect to the instance
`CLOUD_SQL_INSTANCE` names, database `CLOUD_SQL_DATABASE`, as the IAM database
user `CLOUD_SQL_USER`, through the Cloud SQL connector with IAM database
authentication. The deployment's identity SHALL come from Vercel's OIDC token
exchanged for the service account the federation binds to that Vercel
environment. The provider SHALL hold no password and no connection string.

#### Scenario: A production deployment reaches Postgres without a URL (manual)

- **WHEN** the Production environment sets `DB_PROVIDER=cloud-sql`, the
  `CLOUD_SQL_*` variables, and the federation variables, and sets no
  `DATABASE_URL`
- **THEN** `GET /api/sync` on the production deployment answers
  `{ "enabled": true, "db": "ok" }`, and the Cloud SQL instance's logs show the
  connection authenticated as the production IAM database user

### Requirement: A cloud-sql provider missing a variable is unconfigured

With `DB_PROVIDER=cloud-sql`, the provider SHALL report itself unconfigured
when any of the three `CLOUD_SQL_*` variables or the federation variables is
unset, and SHALL attempt no token exchange.

#### Scenario: A variable is missing (manual)

- **WHEN** `DB_PROVIDER=cloud-sql` is set and `CLOUD_SQL_USER` is not
- **THEN** `GET /api/sync` answers `{ "enabled": false, "db": "unconfigured" }`,
  and no token exchange is attempted

Checked by the unit test "reports unconfigured when a Cloud SQL variable is
missing" in `client-v2/src/features/persistence/model/db.test.mjs`.

### Requirement: Only production may open the production database

The `cloud-sql` provider SHALL refuse to create a pool when `VERCEL_ENV` is
not `production` and `CLOUD_SQL_DATABASE` is `solpg`. The refusal SHALL happen
before any token exchange or connection, and `GET /api/sync` SHALL then answer
`db: "unreachable"`. `VERCEL_ENV` is set by Vercel, never by the deployment's
own variables.

#### Scenario: A preview that names the production database is refused (manual)

- **WHEN** a deployment with `VERCEL_ENV=preview` sets `DB_PROVIDER=cloud-sql`
  and `CLOUD_SQL_DATABASE=solpg`
- **THEN** no connection is opened, `GET /api/sync` answers
  `{ "enabled": false, "db": "unreachable" }`, and the function log names the
  refusal

Checked by the unit test "refuses the production database outside production"
in `client-v2/src/features/persistence/model/db.test.mjs`.

#### Scenario: A preview database is allowed (manual)

- **WHEN** a deployment with `VERCEL_ENV=preview` sets `DB_PROVIDER=cloud-sql`
  and `CLOUD_SQL_DATABASE=solpg_preview_pr_42`
- **THEN** the provider creates the pool

Checked by the unit test "allows a preview database outside production" in
`client-v2/src/features/persistence/model/db.test.mjs`.

### Requirement: A pool that failed to build is built again

The functions SHALL build the pool once per instance and reuse it, and SHALL
forget a build that failed, so the next database-backed request builds it
again. A failure of the token exchange, the certificate fetch, or the
provider's own refusal SHALL NOT be kept for the life of the instance.

#### Scenario: A transient failure clears on the next request (manual)

- **WHEN** the first request on a warm instance cannot build the pool and the
  next one can
- **THEN** the first request's `GET /api/sync` answers `db: "unreachable"` and
  the next answers `db: "ok"`, with no redeploy

Checked by the unit test "retries a pool that failed to build" in
`client-v2/src/features/persistence/model/db.test.mjs`.

### Requirement: Routes read the provider through one entry point

Every database-backed route and the session store SHALL obtain the pool
through the persistence feature's server entry point and SHALL carry no
provider-specific code. `GET /api/sync` SHALL answer the same three shapes
whatever the provider: `db: "unconfigured"` when the provider is not
configured, `db: "ok"` after a successful `select 1`, `db: "unreachable"`
otherwise, with no host, user, or error text in the body.

#### Scenario: The probe hides the provider (manual)

- **WHEN** `GET /api/sync` is called on a deployment whose provider cannot
  connect
- **THEN** the body is exactly `{ "enabled": false, "db": "unreachable" }`

Checked by the test "reports unreachable without detail" in
`client-v2/api/sync.test.mjs`.
