# Spec Delta

## Purpose

Production's Postgres on Cloud SQL: the identity the functions connect with,
the instance settings that keep Postgres's own port closed, the two targets
every migration reaches, and the cutover that moves the data with a rollback
at every step.

## ADDED Requirements

### Requirement: Production connects as a federated identity, without a key

The Production environment SHALL connect to database `solpg` on instance
`solpg` through the `cloud-sql` provider as a dedicated IAM database user. The
Production deployment's OIDC token SHALL map, through Workload Identity
Federation, to a service account bound to that one Vercel project and
environment, and no service-account key, database password, or connection
string SHALL be stored for production anywhere.

#### Scenario: The production variables (manual)

- **WHEN** the Production environment's variables are listed
- **THEN** `DB_PROVIDER=cloud-sql`, `CLOUD_SQL_INSTANCE`, `CLOUD_SQL_DATABASE`,
  `CLOUD_SQL_USER`, and the federation variables are present, and
  `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and every other `DATABASE_*`
  variable are absent

#### Scenario: The federation binding is one environment wide (manual)

- **WHEN** the production service account's principal binding is read
- **THEN** its subject is
  `owner:<team>:project:<project>:environment:production` and no other
  subject may impersonate it

### Requirement: Postgres's port on the production instance accepts nothing from outside

Instance `solpg` SHALL have IAM database authentication on, connector
enforcement required, encrypted-only connections, and no authorised network.
Every connection SHALL arrive through Google's connector front end with a
client certificate issued to an IAM identity holding the Cloud SQL Client role
on the instance.

#### Scenario: The instance settings (manual)

- **WHEN** the instance is described with `gcloud sql instances describe solpg`
- **THEN** `settings.databaseFlags` holds `cloudsql.iam_authentication=on`,
  `settings.connectorEnforcement` is `REQUIRED`,
  `settings.ipConfiguration.sslMode` is `ENCRYPTED_ONLY`, and
  `settings.ipConfiguration.authorizedNetworks` is empty

#### Scenario: A direct connection is refused (manual)

- **WHEN** `psql` is pointed at the instance's public address on port 5432
  from outside Google Cloud
- **THEN** the connection is refused before authentication

### Requirement: Pool size follows the instance's connection limit

The production pool SHALL keep its per-instance maximum small enough that the
number of concurrent function instances the deployment reaches, multiplied by
that maximum, stays below the instance's `max_connections`. A change to either
side SHALL be checked against the other and recorded in
`client-v2/docs/cloud-sql.md`.

#### Scenario: The sizing is recorded (manual)

- **WHEN** a reviewer reads the pool's `max` in the `cloud-sql` provider and
  `client-v2/docs/cloud-sql.md`
- **THEN** the document states the instance's `max_connections`, the pool's
  `max`, the concurrent instance count the product allows for, and the date
  the count was last read from Vercel

### Requirement: A production migration reaches both targets

`migrate-production-db` SHALL print the two targets it is about to migrate,
database `solpg` on Cloud SQL and Neon `main`, list the pending migrations on
each, and require a typed `yes` once before applying to both. It SHALL reach
Cloud SQL through the Cloud SQL Auth Proxy with federated or user credentials,
never a stored password. When one target fails, the other SHALL still be
reported, and the target left behind SHALL be named.

#### Scenario: Nothing pending (manual)

- **WHEN** both targets are at the newest migration
- **THEN** the target prints both hosts and "nothing to apply", and asks no
  question

#### Scenario: One target behind (manual)

- **WHEN** Neon `main` has a pending migration and Cloud SQL `solpg` does not
- **THEN** the target prints the pending migration under Neon `main` only, asks
  once, and applies it there only

### Requirement: The cutover moves the data behind a write freeze

The move from Neon to Cloud SQL SHALL happen with `SYNC_ENABLED=false` on
Production, so no write reaches either database while the Neon data is
restored into `solpg`. Before `SYNC_ENABLED` returns to `true`, the production
deployment's `GET /api/sync` SHALL answer `db: "ok"` through the `cloud-sql`
provider, and a row count per table SHALL match Neon's. Until that point,
restoring `DATABASE_URL` on Production and redeploying SHALL be a complete
rollback.

#### Scenario: Writes are frozen during the restore (manual)

- **WHEN** `SYNC_ENABLED=false` is set on Production and the deployment is
  redeployed
- **THEN** `GET /api/sync` answers `enabled: false`, the client reports sync
  off, and `PUT /api/projects` answers 503

#### Scenario: The restore is verified before writes return (manual)

- **WHEN** the restore into `solpg` completes
- **THEN** `select count(*)` per table on `solpg` equals the same count on Neon
  `main`, and the counts are recorded in the cutover PR

#### Scenario: Rollback before the switch (manual)

- **WHEN** the production deployment's `GET /api/sync` answers
  `db: "unreachable"` after the switch to `cloud-sql`
- **THEN** restoring `DATABASE_URL` and `DB_PROVIDER=url` on Production and
  redeploying makes it answer `db: "ok"` again, with no data lost, because no
  write happened since the freeze

### Requirement: A push to master is checked against production

After a push to `master` deploys `client-v2` to production, a CI job SHALL
wait for that deployment and call its `GET /api/sync`, and SHALL fail when the
answer is not `{ "enabled": true, "db": "ok" }`. The failure SHALL name the
deployment URL and the body received.

#### Scenario: The production database is reachable (manual)

- **WHEN** a push to `master` has deployed and the smoke job runs
- **THEN** the job passes and its summary shows the deployment URL and
  `db: "ok"`

#### Scenario: The production database is not reachable (manual)

- **WHEN** the deployment's `GET /api/sync` answers `db: "unreachable"`
- **THEN** the job fails, naming the URL and the body
