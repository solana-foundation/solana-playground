# Preview databases

Every preview of `client-v2` reads a Postgres database on the preview Cloud SQL instance, `solpg-preview`, never
the production instance. Which database depends on how the preview was deployed:

| Preview | Deployed by | Database |
| --- | --- | --- |
| Any PR, any push | The Vercel Git integration | The shared `solpg_preview` |
| A PR labelled `preview` | [`preview.yml`](../../.github/workflows/preview.yml) | Its own `solpg_preview_pr_<number>` |
| A laptop deploy | `make deploy-client-to-vercel-preview DB_PROVIDER=cloud-sql` | Its own `solpg_preview_br_<branch>_<hash>` |

The repository variable `PREVIEW_DB_PROVIDER` turns on the Cloud SQL path for the label. While it is unset, the
label still cuts a Neon branch, as [Neon preview databases](neon.md) describes; that path goes once every preview
runs on Cloud SQL. A laptop deploy picks its provider with `DB_PROVIDER` (`url`, Neon, by default).

The application reaches the instance through the `cloud-sql` provider (`src/features/persistence/model/providers/`)
with the Preview deployment's Vercel OIDC token, exchanged for the `vercel-preview` service account; the workflows
reach it through the Cloud SQL Auth Proxy as the `github-ci` service account. Neither identity holds a role on the
production instance, and the provider refuses the production database name outside Production. The Google Cloud,
GitHub, and Vercel setup behind both is in [Cloud SQL for client-v2](cloud-sql.md).

## The shared database

`solpg_preview` is named by the Preview environment on Vercel (`CLOUD_SQL_DATABASE`), so every preview the Git
integration builds reads it with no workflow involved. Previews share its rows: a project synced from one PR's
preview is visible from another's, under the same GitHub account. That is test data; a PR that needs rows of its
own takes the label.

It carries the migrations on `master` and no others.
[`preview-shared-db.yml`](../../.github/workflows/preview-shared-db.yml) migrates it on every push to `master` that changes `client-v2/db/migrations`, and on a manual run (Actions → preview-shared-db →
Run workflow, with `master` selected: a run from any other branch is skipped, so no branch's migrations reach the
shared database). No workflow that runs on a PR migrates it: a `pull_request` run executes the PR's own workflow and
migrations, and a PR's schema on the shared database would break every other preview.

So a PR that adds a migration gets a preview whose code expects a schema the shared database lacks. `preview.yml`
says so: on an unlabelled PR that changes a file under `client-v2/db/migrations`, it writes the PR's preview comment
naming the files and suggesting the `preview` label. A PR from a fork, whose token cannot comment, gets the same
text in the run's summary. The other direction breaks too: once a migration that drops or renames something lands,
previews of PRs based on an older `master` fail until they are rebased, so such a migration is written in two
steps, as it is for production.

## A database of its own: the `preview` label

With `PREVIEW_DB_PROVIDER` set to `cloud-sql`:

| PR event | What happens |
| --- | --- |
| `preview` label added, or a labelled PR opened, reopened or pushed to | Create or reuse `solpg_preview_pr_<n>`, a copy of `solpg_preview` without its sessions; apply pending migrations to it; `vercel build` on the runner; deploy the prebuilt output with `DB_PROVIDER=cloud-sql` and `CLOUD_SQL_DATABASE=solpg_preview_pr_<n>`; post the URL in the PR's one preview comment |
| `preview` label removed, or PR closed or merged | Drop `solpg_preview_pr_<n>`, ending the sessions still on it |

The name comes from the PR number alone (`scripts/db/preview-name.mjs`); no input, label, or variable can name
another database. A push cancels the deploy it supersedes; a close cancels a deploy still running. Forks and
Dependabot get no deploy, as on Neon.

The PR's database starts as a copy of `solpg_preview`: its schema, its rows, and its `schema_migrations`, which are
`master`'s. dbmate then applies only the PR's own migrations, on top of the rows previews have written, so a
migration that adds a `NOT NULL` column or a unique index meets existing data as it will in production. The copy
leaves out the rows of `session`: a sign-in made on another preview is not valid on this one.

The copy is made once, on the first deploy; later pushes reuse the database and apply only new migrations. To take a
fresh copy, remove the label and add it again. The copy is `pg_dump` into `psql`
(`scripts/db/cloud-sql/create-preview-db`), not `CREATE DATABASE ... TEMPLATE`: Postgres refuses to clone a
database while any session is connected to it, and every preview is connected to `solpg_preview`, while `pg_dump`
reads one consistent snapshot with them connected. The database's comment records whether the copy finished
(`copying:<epoch>`, then `created-at:<epoch>`), so a deploy cancelled mid-copy is copied again on the next run
rather than reused half full.

Every migration runs as the application's database user (`options=-c role=<user>` in the URL dbmate reads), and
the copy is restored as that user, so the application owns every table it uses.

[`preview-sweep.yml`](../../.github/workflows/preview-sweep.yml) is the safety net for a teardown that was cancelled
or failed. Daily, it drops every `solpg_preview_pr_<n>` older than its `MIN_AGE_MINUTES` whose PR is no longer
open and labelled. A database's age is read from that comment, finished or not; one without a stamp is kept. The sweep lists only names matching `^solpg_preview_pr_[0-9]+$`, so it never touches
`solpg_preview` or a laptop's database. Run by hand, from `master` only, it defaults to a dry run.

## Configuration

GitHub, on the repository that runs the preview workflows:

| Name | Kind | Value |
| --- | --- | --- |
| `PREVIEW_REPOSITORY` | variable | `<owner>/<name>` of this repository; the preview workflows run only where it matches |
| `PREVIEW_DB_PROVIDER` | variable | `cloud-sql`; unset keeps the label on Neon |
| `PREVIEW_CLOUD_SQL_INSTANCE` | variable | `<project>:<region>:solpg-preview` |
| `PREVIEW_CLOUD_SQL_USER` | variable | The `vercel-preview` IAM database user: its e-mail without `.gserviceaccount.com` |
| `GCP_CI_WORKLOAD_IDENTITY_PROVIDER` | variable | `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<github provider>` |
| `GCP_CI_SERVICE_ACCOUNT` | variable | The `github-ci` service account's e-mail |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | secret, variables | As for the Neon path ([Configuration](neon.md#configuration)) |

None of these is a secret: the federation grants a token only to a workflow of this repository, so no Google key is
stored anywhere.

```sh
REPO=<owner>/<name>
gh variable set PREVIEW_REPOSITORY --repo "$REPO" --body "$REPO"
gh variable set PREVIEW_DB_PROVIDER --repo "$REPO" --body cloud-sql
gh variable set PREVIEW_CLOUD_SQL_INSTANCE --repo "$REPO"
gh variable set PREVIEW_CLOUD_SQL_USER --repo "$REPO"
gh variable set GCP_CI_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO"
gh variable set GCP_CI_SERVICE_ACCOUNT --repo "$REPO"
gh label create preview --repo "$REPO" --description "Deploy a preview with its own database"
```

Vercel, on the Preview environment, read by every preview the Git integration builds:

| Name | Value |
| --- | --- |
| `DB_PROVIDER` | `cloud-sql` |
| `CLOUD_SQL_INSTANCE` | `<project>:<region>:solpg-preview` |
| `CLOUD_SQL_DATABASE` | `solpg_preview` |
| `CLOUD_SQL_USER` | The `vercel-preview` IAM database user |
| `GCP_PROJECT_NUMBER`, `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | The Vercel federation pool and provider |
| `GCP_SERVICE_ACCOUNT_EMAIL` | The `vercel-preview` service account's e-mail |

Remove `DATABASE_URL` from the Preview environment once these are set. A labelled deploy passes `DB_PROVIDER` and
its own `CLOUD_SQL_DATABASE` on top of these; a Neon one passes `DB_PROVIDER=url` and its `DATABASE_URL`, so neither
pairs one provider with the other's database.

## By hand

From `client-v2/`, logged in with `gcloud auth login` as an operator who holds the preview roles, with
`cloud-sql-proxy`, `psql`, and `pg_dump` (at the instance's major version) installed and the instance and user exported as `CLOUD_SQL_INSTANCE` and
`CLOUD_SQL_USER`:

```sh
scripts/db/cloud-sql/migration-url shared -- dbmate --no-dump-schema status   # the shared database
scripts/db/cloud-sql/drop-preview-db --pr <number>                            # a leftover PR database
```

## Known gaps

- **Not yet run against Google Cloud.** The scripts were exercised against a local Postgres through a stub proxy;
  the federation, the proxy's IAM login, and the workflows wait for the setup in [Cloud SQL for
  client-v2](cloud-sql.md).
