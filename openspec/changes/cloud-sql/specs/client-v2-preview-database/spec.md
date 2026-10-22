# Spec Delta

## Purpose

A preview deployment's own database: where it lives, what it is called, how it
is migrated and dropped, and the guarantee that no preview, whatever its
label or variables, can reach the production database.

## ADDED Requirements

### Requirement: The preview label chooses the database host

A PR labelled `preview` SHALL get a Neon branch `preview/pr-<number>` cut from
Neon `main`, as before. A PR labelled `preview:cloud-sql` SHALL instead get a
database of its own on the Cloud SQL instance `solpg-preview`, and its
deployment SHALL run with `DB_PROVIDER=cloud-sql`. A PR carrying both labels
SHALL get the Cloud SQL database. A laptop deploy through `Makefile.vercel`
SHALL choose the host the same way through `DB_PROVIDER`.

#### Scenario: A Neon preview (manual)

- **WHEN** the `preview` label is added to a PR
- **THEN** the PR comment names the Neon branch `preview/pr-<number>`, and
  `GET /api/sync` on the preview URL answers `{ "enabled": true, "db": "ok" }`

#### Scenario: A Cloud SQL preview (manual)

- **WHEN** the `preview:cloud-sql` label is added to a PR
- **THEN** the PR comment names a database `solpg_preview_<id>` on
  `solpg-preview`, and `GET /api/sync` on the preview URL answers
  `{ "enabled": true, "db": "ok" }`

#### Scenario: Both labels (manual)

- **WHEN** a PR carries `preview` and `preview:cloud-sql`
- **THEN** one deployment is made, against the Cloud SQL database, and no Neon
  branch is created for the PR

### Requirement: A Cloud SQL preview database is named after the git branch

The database name SHALL be `solpg_preview_<id>`, where `<id>` is the PR's head
branch lower-cased with every character outside `[a-z0-9_]` replaced by `_`.
When the whole name would exceed 63 bytes, `<id>` SHALL be cut so that the name
with `_` and the first eight hexadecimal characters of the SHA-256 of the
original branch name appended fits in 63 bytes. The name SHALL contain no
hyphen. The same function SHALL produce the name wherever it is needed: the
workflows, `Makefile.vercel`, and the provisioning scripts.

#### Scenario: A short branch (manual)

- **WHEN** the head branch is `fix/Sync-Race`
- **THEN** the database is `solpg_preview_fix_sync_race`

Checked by the test "names a database after a short branch" in
`client-v2/scripts/db/preview-name.test.mjs`.

#### Scenario: A long branch (manual)

- **WHEN** the head branch is 70 characters long
- **THEN** the database name is at most 63 bytes, ends in `_` followed by
  eight hexadecimal characters, and two long branches that differ only after
  the cut get different names

Checked by the test "cuts a long branch and appends a hash" in
`client-v2/scripts/db/preview-name.test.mjs`.

#### Scenario: Two branches that sanitise alike (manual)

- **WHEN** the head branches are `fix/a-b` and `fix/a_b`
- **THEN** the two database names differ

Checked by the test "keeps branches that sanitise alike apart" in
`client-v2/scripts/db/preview-name.test.mjs`.

### Requirement: A Cloud SQL preview database is migrated on every deploy

Each deploy of a `preview:cloud-sql` PR SHALL create the database when it does
not exist, owned by the preview IAM database user, and SHALL apply pending
migrations to it through the Cloud SQL Auth Proxy before the deployment is
built. A failed migration SHALL fail the deploy and SHALL be reported on the
PR, and the earlier preview, if any, SHALL keep serving.

#### Scenario: A push adds a migration (manual)

- **WHEN** a labelled PR is pushed to with a new file under
  `client-v2/db/migrations`
- **THEN** the run's migration step applies that migration only, and the
  deployment's `GET /api/sync` answers `db: "ok"`

#### Scenario: A migration fails (manual)

- **WHEN** the migration step fails
- **THEN** no deployment is made, the PR gets the failure comment with the run
  link, and the previous preview URL still answers

### Requirement: A Cloud SQL preview database is dropped with its preview

When the `preview:cloud-sql` label is removed or the PR is closed, the
workflow SHALL drop the PR's database and edit the PR comment to say so. The
daily sweep SHALL drop every `solpg_preview_*` database older than its minimum
age whose PR is no longer open and labelled, and SHALL touch no other database
on any instance.

#### Scenario: Label removed (manual)

- **WHEN** `preview:cloud-sql` is removed from an open PR
- **THEN** the database no longer exists on `solpg-preview`, and the PR comment
  says it was dropped

#### Scenario: The sweep finds a leftover (manual)

- **WHEN** a `solpg_preview_*` database exists whose PR is closed, and the
  sweep runs with `dry_run` unticked
- **THEN** the sweep's summary names it as deleted, and the database no longer
  exists

#### Scenario: The sweep ignores the production instance (manual)

- **WHEN** the sweep runs
- **THEN** it lists and drops databases on `solpg-preview` only; `solpg` is
  never connected to

### Requirement: A preview cannot reach the production database

Four independent checks SHALL each, alone, keep a preview off database `solpg`
on instance `solpg`: the service account a Preview deployment's token maps to
SHALL hold no Cloud SQL role on instance `solpg`; `CONNECT` on database
`solpg` SHALL be revoked from `PUBLIC` and granted to the production IAM user
alone; the `cloud-sql` provider SHALL refuse `CLOUD_SQL_DATABASE=solpg` when
`VERCEL_ENV` is not `production`; and the workflows and `Makefile.vercel`
SHALL derive the preview database name from the branch, with no input,
label, or variable that can name another database.

#### Scenario: The preview identity has no role on the production instance (manual)

- **WHEN** the preview service account's IAM policy bindings are listed
- **THEN** every Cloud SQL role is bound with a condition naming instance
  `solpg-preview`, and none names `solpg`

#### Scenario: Only the production user may connect (manual)

- **WHEN** `\l solpg` is run on the instance through the proxy
- **THEN** the access privileges column shows `CONNECT` for the production IAM
  user and no entry for `PUBLIC`

#### Scenario: No way to name another database (manual)

- **WHEN** a reviewer reads `preview.yml`, `preview-sweep.yml`, and
  `Makefile.vercel`
- **THEN** every `CLOUD_SQL_DATABASE` value is the output of the naming
  function applied to the branch, and no workflow input or make variable sets
  it
