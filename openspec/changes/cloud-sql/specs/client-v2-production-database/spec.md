# Spec Delta

## Purpose

Production's Postgres on Cloud SQL: the identity the functions connect with,
the instance settings that keep Postgres's own port closed, who migrates it
and which database a migration reaches, the cutover that switches production
to an empty, migrated `solpg` with a rollback at every step, and the guide that lets the upstream repository's
maintainers set all of it up themselves.

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

#### Scenario: The production identity connects before the cutover (manual)

- **WHEN** a staged production deployment (`vercel deploy --prod
  --skip-domain`, assigned no domain) is made with `DB_PROVIDER=cloud-sql`,
  the `CLOUD_SQL_*` variables naming the empty `solpg`, the federation
  variables, and `SYNC_ENABLED=false`, each passed to that deployment alone
- **THEN** its `GET /api/sync` answers `{ "enabled": false, "db": "ok" }`, and
  the instance's logs show the connection authenticated as the production IAM
  database user, with no operator credential involved

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

### Requirement: A production migration reaches the database production reads

`migrate-production-db` SHALL migrate the one database the Production
environment reads, chosen by Production's `DB_PROVIDER`: the production Neon
project through its unpooled URL while it is `url` or unset, and database
`solpg` through the Cloud SQL Auth Proxy once it is `cloud-sql`. It SHALL
print the target's host and database and the pending migrations, and require a
typed `yes` before applying them.

#### Scenario: Nothing pending (manual)

- **WHEN** the target is at the newest migration
- **THEN** the make target prints its host and database and "nothing to
  apply", and asks no question

#### Scenario: Production on Cloud SQL (manual)

- **WHEN** Production's `DB_PROVIDER` is `cloud-sql` and a migration is pending
- **THEN** the make target names `solpg` on instance `solpg`, never a Neon
  host, applies the migration after `yes`, and the tables it creates are owned
  by the production IAM user

### Requirement: Production is migrated by a person

`migrate-production-db` SHALL reach `solpg` as the operator's own Google
identity, an IAM database user on `solpg`, with the session role set to the
production IAM user, and never with a stored password, a key, or a CI
identity.

#### Scenario: CI cannot migrate production (manual)

- **WHEN** the IAM policy bindings of `github-ci` are listed
- **THEN** none grants a Cloud SQL role on instance `solpg`

### Requirement: The cutover switches production to an empty, migrated database

Production SHALL move to Cloud SQL without copying data: the production
Neon project holds no user data to keep, so `solpg` starts empty. Every
migration SHALL be applied to `solpg`, under the production IAM user's role,
before Production's variables name it. Sync SHALL stay on throughout; nothing
is frozen, because nothing moves. Until the production Neon project is
deleted, restoring `DATABASE_URL` and `DB_PROVIDER=url` on Production and
redeploying SHALL be a complete rollback, and anything written to `solpg`
in between is test data and may be lost.

#### Scenario: solpg is ready before the switch (manual)

- **WHEN** the migrations have been applied to `solpg` and Production still
  reads Neon
- **THEN** `dbmate status` through `migration-url production` lists every
  migration as applied, and `\dt` shows every table owned by the production
  IAM user

#### Scenario: Production runs on solpg after the switch (manual)

- **WHEN** Production's variables name `solpg` through the `cloud-sql`
  provider, `DATABASE_URL` is removed, and Production is redeployed
- **THEN** `GET /api/sync` answers `{ "enabled": true, "db": "ok" }`,
  `migrate-production-db` names `solpg` and reports nothing to apply, and a
  sign-in followed by a project edit on the production domain writes a row to
  `solpg`

#### Scenario: Rollback after the switch (manual)

- **WHEN** the production deployment's `GET /api/sync` answers
  `db: "unreachable"` after the switch to `cloud-sql`
- **THEN** restoring `DATABASE_URL` and `DB_PROVIDER=url` on Production and
  redeploying makes it answer `db: "ok"` again from the untouched production
  Neon project

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

### Requirement: A maintainer guide sets the pipeline up from nothing

`client-v2/docs/cloud-sql.md` SHALL be written for maintainers of
`solana-foundation/solana-playground` who did not build this change. It SHALL
describe the design of the pipeline, then give, in order, every step that sets
it up in an empty Google Cloud project, a Vercel project, and a GitHub
repository, with each value specific to this deployment as a placeholder.

#### Scenario: The design is explained before the steps (manual)

- **WHEN** a maintainer reads the guide's design section
- **THEN** it states which identity reaches which instance, the four gates
  between a preview and `solpg`, which workflow creates, migrates, and drops
  which database, and who migrates production

#### Scenario: The setup steps are complete (manual)

- **WHEN** a reviewer compares the guide with tasks 2.1, 2.3, and 3.1
- **THEN** every `gcloud`, `vercel`, `gh`, and SQL command those tasks ran is
  in the guide, in the order it must run, and no project id, team, instance
  address, or e-mail address appears except as a placeholder

#### Scenario: The guide covers every party (manual)

- **WHEN** a reviewer reads the guide's setup section
- **THEN** it covers Google Cloud (both instances, their flags, the template
  base, both federation pools and providers, the three service accounts and
  their conditional bindings, the IAM database users and role memberships),
  Vercel (the OIDC issuer mode, the variables per environment, the function
  region), GitHub (the repository variables and secrets the preview workflows
  read, the `preview` and `preview:cloud-sql` labels), and adding an operator

#### Scenario: The guide is the runbook for the cutover and its rollback (manual)

- **WHEN** a maintainer moves another deployment from a connection string to
  Cloud SQL
- **THEN** the guide's cutover and rollback steps match task 3.2, with the
  checks that must pass before the switch, and say that a deployment with
  users to keep needs a data copy behind a write freeze, which this guide
  does not give
