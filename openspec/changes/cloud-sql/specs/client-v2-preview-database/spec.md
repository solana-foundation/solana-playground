# Spec Delta

## Purpose

The databases preview deployments read: the shared one every preview starts
on, and a labelled PR's own; where they live, what they are called, what they
start with, how they are migrated and dropped, and the guarantee that no
preview, whatever its label or variables, can reach the production database.

## ADDED Requirements

### Requirement: Every preview reads the shared preview database

The Preview environment on Vercel SHALL set `DB_PROVIDER=cloud-sql` and
`CLOUD_SQL_DATABASE=solpg_preview` on instance `solpg-preview`, so every
preview the Git integration builds, for an integration branch, reads and writes the shared
database `solpg_preview` with no workflow run before it.

#### Scenario: An integration branch's preview (manual)

- **WHEN** an integration branch is pushed to and the Git integration
  deploys it
- **THEN** `GET /api/sync` on that deployment answers
  `{ "enabled": true, "db": "ok" }`, and the instance's log shows the Preview
  IAM database user connecting to `solpg_preview`

### Requirement: The shared preview database is migrated from master by convention

`preview-shared-db.yml` SHALL migrate `solpg_preview` on every push to `master` that changes a file under
`client-v2/db/migrations`, and on manual dispatch, through the Cloud SQL Auth
Proxy under the preview IAM database user's role. No workflow that runs on
`pull_request` SHALL migrate it. This is a convention enforced by review of
changes to the workflows, not by the service account: a branch runs its own
copy of the workflow on manual dispatch, and the same `github-ci` account runs
`preview.yml` on `pull_request`.

#### Scenario: A migration lands on master (manual)

- **WHEN** a PR that adds a migration is merged into `master`
- **THEN** the `preview-shared-db.yml` run for that push applies it to
  `solpg_preview`, and the tables it creates are owned by the preview IAM
  database user

#### Scenario: A PR's run leaves the shared database alone (manual)

- **WHEN** a reviewer reads every workflow triggered by `pull_request`
- **THEN** none passes `shared` to `migration-url`

### Requirement: A PR that changes migrations is told to take its own database

On a PR from an integration branch without the `preview` label that adds,
changes, or removes a file under `client-v2/db/migrations`, `preview.yml` SHALL write the PR's preview
comment saying the automatic preview reads `solpg_preview`, which lacks the
PR's migrations, and that the `preview` label gives the PR a database that has
them. A PR from a fork, whose token cannot comment, SHALL get the same text as
a warning in the job summary.

#### Scenario: An unlabelled integration-branch PR adds a migration (manual)

- **WHEN** a PR from an integration branch without the label is pushed to
  with a new file under `client-v2/db/migrations`
- **THEN** the PR's preview comment names the shared database and suggests
  the `preview` label

#### Scenario: The label is added (manual)

- **WHEN** that PR is then labelled `preview`
- **THEN** no new notice is written, and the deploy's comment replaces it

#### Scenario: A PR without migrations (manual)

- **WHEN** an unlabelled PR changes no file under `client-v2/db/migrations`
- **THEN** no notice is written

### Requirement: The preview label gives a PR its own database

While the repository variable `PREVIEW_DB_PROVIDER` is `cloud-sql`, a PR
labelled `preview` SHALL get a database of its own on `solpg-preview`, and its
deployment from `preview.yml` SHALL run with `DB_PROVIDER=cloud-sql` and that
database as `CLOUD_SQL_DATABASE`. While the variable is unset, the label SHALL
get a Neon branch `preview/pr-<number>` cut from `main` of the preview Neon
project, as before. A laptop deploy through `Makefile.vercel` SHALL choose
the host through `DB_PROVIDER`.

#### Scenario: A labelled Cloud SQL preview (manual)

- **WHEN** `PREVIEW_DB_PROVIDER` is `cloud-sql` and the `preview` label is added
  to a PR
- **THEN** the PR comment names the database `solpg_preview_pr_<number>` on
  `solpg-preview`, and `GET /api/sync` on the preview URL answers
  `{ "enabled": true, "db": "ok" }`

#### Scenario: A labelled Neon preview (manual)

- **WHEN** `PREVIEW_DB_PROVIDER` is unset and the `preview` label is added to a
  PR
- **THEN** the PR comment names the Neon branch `preview/pr-<number>`, and no
  Cloud SQL database is created for the PR

### Requirement: A Cloud SQL preview database is named after its PR

A labelled PR's database SHALL be `solpg_preview_pr_<number>`. One module,
`client-v2/scripts/db/preview-name.mjs`, SHALL produce every Cloud SQL preview
database name wherever one is needed: the workflows, `Makefile.vercel`, and
the provisioning scripts.

#### Scenario: A PR's database (manual)

- **WHEN** PR 42 is labelled `preview`
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

### Requirement: A Cloud SQL preview database is a copy of the shared database

A labelled PR's database SHALL be created, on its first deploy, as a copy of
`solpg_preview` taken while previews stay connected to it: its schema, its
rows, and its applied migrations, with no rows of the `session` table. Every
table of the copy SHALL be owned by the preview IAM database user. A copy
that did not finish SHALL never be deployed: the next deploy SHALL copy again.

#### Scenario: A new preview starts from the shared rows (manual)

- **WHEN** a PR that adds a migration is first labelled `preview`
- **THEN** its database holds the rows of `solpg_preview`, and dbmate applies
  only the PR's migrations, on top of those rows

#### Scenario: Sessions stay behind (manual)

- **WHEN** a user signed in on an unlabelled preview opens a labelled PR's
  preview
- **THEN** the labelled preview's database holds no row of `session`, and the
  user is asked to sign in

#### Scenario: A cancelled copy is redone (manual)

- **WHEN** a labelled PR's deploy is cancelled while its database is being
  copied, and the PR is pushed to again
- **THEN** the next run drops the unfinished database, copies again, and
  deploys on the complete copy

### Requirement: A Cloud SQL preview database is migrated on every deploy

Each deploy of a `preview` PR SHALL create the database when it does
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

When the `preview` label is removed or the PR is closed, the
workflow SHALL drop the PR's database and edit the PR comment to say so. The
daily sweep SHALL drop every `solpg_preview_pr_<number>` database older than
its minimum age whose PR is no longer open and labelled, and SHALL touch no
other database on any instance.

#### Scenario: Label removed (manual)

- **WHEN** `preview` is removed from an open PR
- **THEN** the database no longer exists on `solpg-preview`, and the PR comment
  says it was dropped

#### Scenario: The sweep finds a leftover (manual)

- **WHEN** a `solpg_preview_pr_<number>` database exists whose PR is closed,
  and the sweep runs with `dry_run` unticked
- **THEN** the sweep's summary names it as deleted, and the database no longer
  exists

#### Scenario: The sweep leaves the base and laptop databases (manual)

- **WHEN** the sweep runs
- **THEN** it drops no database whose name is not `solpg_preview_pr_`
  followed by digits, so `solpg_preview` and every
  `solpg_preview_br_*` remain; and it lists
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
with no input, label, or variable that can name another database. The one
fixed name, `solpg_preview`, SHALL be set in the Preview environment on Vercel
and passed by no workflow to a deployment.

#### Scenario: No way to name another database (manual)

- **WHEN** a reviewer reads `preview.yml`, `preview-sweep.yml`, and
  `Makefile.vercel`
- **THEN** every `CLOUD_SQL_DATABASE` value they pass is the output of the
  naming module applied to the PR number or the git branch, and no workflow
  input or make variable sets it
