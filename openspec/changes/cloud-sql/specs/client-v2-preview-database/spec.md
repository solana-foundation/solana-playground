# Spec Delta

## Purpose

A preview deployment's own database: where it lives, what it is called, what
it starts with, how it is migrated and dropped, and the guarantee that no
preview, whatever its label or variables, can reach the production database.

## ADDED Requirements

### Requirement: The preview label chooses the database host

A PR labelled `preview` SHALL get a Neon branch `preview/pr-<number>` cut from
`main` of the preview Neon project, as before. A PR labelled
`preview:cloud-sql` SHALL instead get a database of its own on the Cloud SQL
instance `solpg-preview`, and its deployment SHALL run with
`DB_PROVIDER=cloud-sql`. A PR carrying both labels SHALL get the Cloud SQL
database. A laptop deploy through `Makefile.vercel` SHALL choose the host the
same way through `DB_PROVIDER`.

#### Scenario: A Neon preview (manual)

- **WHEN** the `preview` label is added to a PR
- **THEN** the PR comment names the Neon branch `preview/pr-<number>`, and
  `GET /api/sync` on the preview URL answers `{ "enabled": true, "db": "ok" }`

#### Scenario: A Cloud SQL preview (manual)

- **WHEN** the `preview:cloud-sql` label is added to a PR
- **THEN** the PR comment names the database `solpg_preview_pr_<number>` on
  `solpg-preview`, and `GET /api/sync` on the preview URL answers
  `{ "enabled": true, "db": "ok" }`

#### Scenario: Both labels (manual)

- **WHEN** a PR carries `preview` and `preview:cloud-sql`
- **THEN** one deployment is made, against the Cloud SQL database, and no Neon
  branch is created for the PR

### Requirement: A Cloud SQL preview database is named after its PR

A labelled PR's database SHALL be `solpg_preview_pr_<number>`. One module,
`client-v2/scripts/db/preview-name.mjs`, SHALL produce every Cloud SQL preview
database name wherever one is needed: the workflows, `Makefile.vercel`, and
the provisioning scripts.

#### Scenario: A PR's database (manual)

- **WHEN** PR 42 is labelled `preview:cloud-sql`
- **THEN** its database is `solpg_preview_pr_42`

Checked by the test "names a PR's database by its number" in
`client-v2/scripts/db/preview-name.test.mjs`.

### Requirement: A laptop deploy's Cloud SQL database is named after its git branch

A laptop deploy's database SHALL be `solpg_preview_br_<id>`, where `<id>` is
the git branch lower-cased with every character outside `[a-z0-9_]` replaced
by `_`, cut so that the name with `_` and the first eight hexadecimal
characters of the SHA-256 of the original branch name appended fits in 63
bytes. No name SHALL contain a hyphen.

#### Scenario: A laptop deploy from a long branch (manual)

- **WHEN** the git branch is 70 characters long
- **THEN** the database name is at most 63 bytes, starts with
  `solpg_preview_br_`, ends in `_` followed by eight hexadecimal characters,
  and two long branches that differ only after the cut get different names

Checked by the test "cuts a long branch and appends a hash" in
`client-v2/scripts/db/preview-name.test.mjs`.

#### Scenario: Two branches that sanitise alike (manual)

- **WHEN** the git branches are `fix/a-b` and `fix/a_b`
- **THEN** the two database names differ

Checked by the test "keeps branches that sanitise alike apart" in
`client-v2/scripts/db/preview-name.test.mjs`.

#### Scenario: A branch named like a PR (manual)

- **WHEN** a laptop deploy runs from a git branch named `pr_42`
- **THEN** its database is not `solpg_preview_pr_42`

Checked by the test "keeps a branch apart from the PR it is named like" in
`client-v2/scripts/db/preview-name.test.mjs`.

### Requirement: A Cloud SQL preview database is cloned from the preview base

A Cloud SQL preview database SHALL be created as a copy of the template
database `solpg_preview_base` on `solpg-preview`, owned by the preview IAM
database user, so it starts with the base's schema, rows, and applied
migrations. The base SHALL hold preview data only, never a copy of
production's, SHALL accept no connection outside `migrate-preview-base`, and
SHALL have every table owned by the preview IAM database user.

#### Scenario: A new preview starts from the base (manual)

- **WHEN** a PR is first labelled `preview:cloud-sql`
- **THEN** its database holds the base's rows, and dbmate applies only the
  migrations under `client-v2/db/migrations` that the base lacks

#### Scenario: The base is migrated forward (manual)

- **WHEN** `migrate-preview-base` runs while the base lacks a migration
- **THEN** the base holds that migration, its tables are owned by the preview
  IAM database user, and it again refuses connections

### Requirement: A Cloud SQL preview database is migrated on every deploy

Each deploy of a `preview:cloud-sql` PR SHALL create the database when it does
not exist and SHALL apply pending migrations to it through the Cloud SQL Auth
Proxy, under the preview IAM database user's role, before the deployment is
built. A failed creation or migration SHALL fail the deploy and SHALL be
reported on the PR, and the earlier preview, if any, SHALL keep serving.

#### Scenario: A push adds a migration (manual)

- **WHEN** a labelled PR is pushed to with a new file under
  `client-v2/db/migrations`
- **THEN** the run's migration step applies that migration only, the tables it
  creates are owned by the preview IAM database user, and the deployment's
  `GET /api/sync` answers `db: "ok"`

#### Scenario: A migration fails (manual)

- **WHEN** the migration step fails
- **THEN** no deployment is made, the PR gets the failure comment with the run
  link, and the previous preview URL still answers

### Requirement: A Cloud SQL preview database is dropped with its preview

When the `preview:cloud-sql` label is removed or the PR is closed, the
workflow SHALL drop the PR's database and edit the PR comment to say so. The
daily sweep SHALL drop every `solpg_preview_pr_<number>` database older than
its minimum age whose PR is no longer open and labelled, and SHALL touch no
other database on any instance.

#### Scenario: Label removed (manual)

- **WHEN** `preview:cloud-sql` is removed from an open PR
- **THEN** the database no longer exists on `solpg-preview`, and the PR comment
  says it was dropped

#### Scenario: The sweep finds a leftover (manual)

- **WHEN** a `solpg_preview_pr_<number>` database exists whose PR is closed,
  and the sweep runs with `dry_run` unticked
- **THEN** the sweep's summary names it as deleted, and the database no longer
  exists

#### Scenario: The sweep leaves the base and laptop databases (manual)

- **WHEN** the sweep runs
- **THEN** it drops no database outside `solpg_preview_pr_*`, so
  `solpg_preview_base` and every `solpg_preview_br_*` remain; and it lists
  databases on `solpg-preview` only, never connecting to `solpg`

### Requirement: No preview or CI identity holds a role on the production instance

Neither the service account a Preview deployment's token maps to nor the one a
GitHub Actions job's token maps to SHALL hold any Cloud SQL role on instance
`solpg`. This is one of four checks that each, alone, keep a preview off
database `solpg`; the others are the grants below, the naming below, and the
`cloud-sql` provider's refusal (`client-v2-database-provider`).

#### Scenario: No preview or CI identity has a role on the production instance (manual)

- **WHEN** the IAM policy bindings of `vercel-preview` and `github-ci` are
  listed
- **THEN** every Cloud SQL role is bound with a condition naming instance
  `solpg-preview`, and none names `solpg`

### Requirement: Only the production user may connect to the production database

`CONNECT` on database `solpg` SHALL be revoked from `PUBLIC` and granted to
the production IAM user alone, which the operators reach through membership of
its role.

#### Scenario: Only the production user may connect (manual)

- **WHEN** `\l solpg` is run on the instance through the proxy
- **THEN** the access privileges column shows `CONNECT` for the production IAM
  user and no entry for `PUBLIC`, and `\du` shows no member of the production
  user's role other than the operators

### Requirement: No input names a preview's database

The workflows and `Makefile.vercel` SHALL derive a Cloud SQL preview
database's name from the PR number or, for a laptop deploy, the git branch,
with no input, label, or variable that can name another database.

#### Scenario: No way to name another database (manual)

- **WHEN** a reviewer reads `preview.yml`, `preview-sweep.yml`, and
  `Makefile.vercel`
- **THEN** every `CLOUD_SQL_DATABASE` value is the output of the naming
  module applied to the PR number or the git branch, and no workflow input or
  make variable sets it
