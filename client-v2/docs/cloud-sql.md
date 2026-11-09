# Cloud SQL for client-v2

How `client-v2`'s serverless functions reach Postgres on Cloud SQL, and every step to set that up in a Google
Cloud project, a Vercel project, and a GitHub repository. The design is the OpenSpec change `cloud-sql`
([proposal](../../openspec/changes/cloud-sql/proposal.md), [design](../../openspec/changes/cloud-sql/design.md));
how previews use their databases is in [Preview databases](preview-databases.md).

Production comes first: steps 1 to 7 set up and cut over the production database and need none of the preview
steps. Steps 8 to 16 move previews to Cloud SQL after the launch; they reuse steps 1 to 4.

> **Not yet run end to end.** The steps below come from the change's design and Google's and Vercel's
> documentation. The steps marked _unverified_ are the ones whose outcome on Cloud SQL for PostgreSQL 17 the
> documentation does not state; tasks 3.1 and 2.1 of the change run them and correct this guide.

## Design

### Identities and what they reach

| Identity | Kind | Reaches | Used by |
| --- | --- | --- | --- |
| `vercel-production` | service account | instance `solpg`, database `solpg` | Vercel's Production environment, through its OIDC token |
| `vercel-preview` | service account | instance `solpg-preview`, every database on it | Vercel's Preview environment, through its OIDC token |
| `github-ci` | service account | instance `solpg-preview` only | `preview.yml`, `preview-sweep.yml`, `preview-shared-db.yml`, through the job's OIDC token |
| An operator | Google user | both instances, as a member of the application's role there | `migrate-production-db`, setup, a hand-run preview script |

No identity has a key or a password. A Vercel deployment's OIDC token and a GitHub job's OIDC token are exchanged
at Google's Security Token Service, through Workload Identity Federation, for a short-lived token of the service
account bound to that subject. The application then logs in to Postgres with IAM database authentication through
the Cloud SQL Node.js Connector; a workflow or an operator logs in through the Cloud SQL Auth Proxy with
`--auto-iam-authn`.

### Databases

| Instance | Database | Owner | Read by | Migrated by |
| --- | --- | --- | --- | --- |
| `solpg` | `solpg` | `vercel-production` | Production | An operator, `migrate-production-db` (`migration-url production`) |
| `solpg-preview` | `solpg_preview` | `vercel-preview` | Every Git-integration preview | `preview-shared-db.yml`, on push to `master` |
| `solpg-preview` | `solpg_preview_pr_<n>` | `vercel-preview` | A PR labelled `preview` | `preview.yml`, on every push to the PR, after copying `solpg_preview` without its sessions |

Every migration runs with its session role set to the owner (`options=-c role=<user>` in the URL dbmate reads), so
the application's user owns every table it uses and needs no grant per table.

### Four gates between a preview and `solpg`

Each is enforced by a different party, so one mistake does not open the production database:

1. **IAM.** Neither `vercel-preview` nor `github-ci` holds a Cloud SQL role on instance `solpg`.
2. **Postgres.** `CONNECT` on database `solpg` is revoked from `PUBLIC`; only `vercel-production` and its members
   may connect.
3. **The application.** The `cloud-sql` provider decides on the instance and the database together, before any
   token exchange (`src/features/persistence/model/providers/cloud-sql.mjs`): Production opens only database
   `solpg` on instance `solpg`; every other environment is refused instance `solpg` and may open only a preview
   database (`solpg_preview`, `solpg_preview_pr_<n>`, `solpg_preview_br_*`).
4. **The workflows.** A preview database's name comes from the PR number alone
   (`scripts/db/preview-name.mjs`); no workflow input or make variable names a database.

The checks for gates 1 and 2 are in [Checks](#checks).

## Values used below

Set once in the shell where the commands run:

```sh
PROJECT_ID=<google cloud project id>
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
REGION=<region of the production instance, for example us-central1>
TEAM_SLUG=<vercel team slug, the path in the team's URL>
VERCEL_PROJECT=<vercel project name>
REPO=<owner>/<name>   # the GitHub repository whose workflows reach the preview instance
OPERATOR=<operator's google account e-mail, lower case>

PREVIEW_SA=vercel-preview@$PROJECT_ID.iam.gserviceaccount.com
PRODUCTION_SA=vercel-production@$PROJECT_ID.iam.gserviceaccount.com
CI_SA=github-ci@$PROJECT_ID.iam.gserviceaccount.com
# IAM database user names: a service account's e-mail without `.gserviceaccount.com`
PREVIEW_DB_USER=vercel-preview@$PROJECT_ID.iam
PRODUCTION_DB_USER=vercel-production@$PROJECT_ID.iam
CI_DB_USER=github-ci@$PROJECT_ID.iam
```

The commands assume `gcloud` is logged in as someone who may administer IAM and Cloud SQL in the project.

## 1. Google Cloud: the project

```sh
gcloud config set project "$PROJECT_ID"
gcloud services enable sqladmin.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com
```

## 2. Google Cloud: federation for Vercel

The provider accepts the audience Vercel puts in its tokens by default, `https://vercel.com/<team>`, which is the
token the application sends (`getVercelOidcToken()` is called without an audience). The team issuer needs the
project's issuer mode set to Team (step 3). Production and previews share this pool and provider; each binds its
own service account to its own environment (steps 4 and 10).

```sh
gcloud iam workload-identity-pools create vercel --location=global --display-name=Vercel
gcloud iam workload-identity-pools providers create-oidc vercel \
  --location=global --workload-identity-pool=vercel \
  --issuer-uri="https://oidc.vercel.com/$TEAM_SLUG" \
  --allowed-audiences="https://vercel.com/$TEAM_SLUG" \
  --attribute-mapping=google.subject=assertion.sub
```

## 3. Vercel: OIDC

In the Vercel project: Settings → Security → Secure backend access with OIDC Federation, enabled, issuer mode
**Team**. The provider in step 2 trusts the team issuer only.

Settings → Functions → Function Region: the Vercel region nearest the instances' region. Each query crosses that
distance; the latency is recorded by task 3.1 for production and task 2.7 for previews.

## 4. Google Cloud: the production service account

`vercel-production` may be impersonated by Vercel's Production environment only:

```sh
gcloud iam service-accounts create vercel-production --display-name="Vercel Production"

POOL=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools
gcloud iam service-accounts add-iam-policy-binding "$PRODUCTION_SA" --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/$POOL/vercel/subject/owner:$TEAM_SLUG:project:$VERCEL_PROJECT:environment:production"
```

The Cloud SQL roles are each bound with a condition naming one instance. `roles/cloudsql.client` lets an identity
connect through the connector or the proxy; `roles/cloudsql.instanceUser` lets it log in with IAM. The condition
form is the one Google documents for `roles/cloudsql.client`; that the same form scopes `roles/cloudsql.instanceUser`
is _unverified_. Define the two helpers here:

```sh
only() {
  echo "expression=resource.name == 'projects/$PROJECT_ID/instances/$1' && resource.service == 'sqladmin.googleapis.com',title=only-$1"
}
grant() { # member instance
  for role in roles/cloudsql.client roles/cloudsql.instanceUser; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$1" --role="$role" --condition="$(only "$2")"
  done
}
```

`only` and `grant` are used in steps 5 and 10 and in [Adding an operator](#adding-an-operator), in the same shell.

## 5. Google Cloud: the production instance

`solpg` exists. List its flags first: `--database-flags` replaces the whole set, so every flag already set goes
into the command with the new one. Changing flags may restart the instance.

The operator who runs this step gets the `cloudsqlsuperuser` role, so the setup needs no password for the built-in
`postgres` user. An operator added later needs only membership of the production user's role ([Adding an
operator](#adding-an-operator)).

```sh
gcloud sql instances describe solpg --format='value(settings.databaseFlags)'
gcloud sql instances patch solpg --database-flags=cloudsql.iam_authentication=on \
  --connector-enforcement=REQUIRED --ssl-mode=ENCRYPTED_ONLY
grant "serviceAccount:$PRODUCTION_SA" solpg
grant "user:$OPERATOR" solpg
gcloud sql users create "$PRODUCTION_DB_USER" --instance=solpg --type=cloud_iam_service_account
gcloud sql users create "$OPERATOR" --instance=solpg --type=cloud_iam_user --database-roles=cloudsqlsuperuser
```

Through the proxy, as the operator (install
[`cloud-sql-proxy`](https://cloud.google.com/sql/docs/postgres/sql-proxy#install) and `psql` first):

```sh
cloud-sql-proxy --auto-iam-authn --gcloud-auth --port 5434 "$PROJECT_ID:$REGION:solpg" &
psql "postgres://$(printf %s "$OPERATOR" | sed 's/@/%40/')@127.0.0.1:5434/postgres?sslmode=disable"
```

```sql
-- The operator may then act as the production user, so the migrations it runs create tables that user owns
GRANT "vercel-production@<project id>.iam" TO "<operator e-mail>";
CREATE DATABASE solpg OWNER "vercel-production@<project id>.iam";
REVOKE CONNECT ON DATABASE solpg FROM PUBLIC;
```

On PostgreSQL 16 and later, `GRANT` of a role needs the `ADMIN` option on the target role. Whether
`cloudsqlsuperuser` holds it on the IAM users Cloud SQL creates is _unverified_. If the `GRANT` answers
`permission denied`, run it as the built-in `postgres` user instead: set a password with
`gcloud sql users set-password postgres --instance=solpg --prompt-for-password`, use it for that statement only,
then set it again to a random value nobody records.

Stop the proxy (`kill %1`). `github-ci` and `vercel-preview` get nothing here.

## 6. Vercel: the Production environment, staged

Set the variables on Production while it still reads Neon, and check them on a deployment that takes no domain.
Build locally and deploy the output: a Vercel build with no cache does not finish inside the build time limit
([Deploy](deploy-client-vercel.md#deploy)). From the repository root, with the CLI version pinned as `VERCEL_CLI` in
`client-v2/Makefile.vercel`, and `VERCEL_DEPLOY_PROJECT_ID` naming the project the Git integration deploys
([Migrations](deploy-client-vercel.md#migrations)):

```sh
make -f client-v2/Makefile.vercel vercel-link-production
npx vercel@62.7.0 build --prod
npx vercel@62.7.0 deploy --prebuilt --archive=tgz --prod --skip-domain \
  -e DB_PROVIDER=cloud-sql -e CLOUD_SQL_INSTANCE="$PROJECT_ID:$REGION:solpg" -e CLOUD_SQL_DATABASE=solpg \
  -e CLOUD_SQL_USER="$PRODUCTION_DB_USER" -e GCP_PROJECT_NUMBER="$PROJECT_NUMBER" \
  -e GCP_WORKLOAD_IDENTITY_POOL_ID=vercel -e GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel \
  -e GCP_SERVICE_ACCOUNT_EMAIL="$PRODUCTION_SA" -e SYNC_ENABLED=false
```

Its `GET /api/sync` answers `{ "enabled": false, "db": "ok" }`, and the instance's log shows the production IAM
user logging in. This proves the production identity's whole path before any data depends on it.

## 7. Cutover

For a deployment with no users to keep: nothing is copied and nothing is frozen. With users, a copy behind a write
freeze is needed, and this guide does not give it.

1. Confirm production still has no users.
2. Migrate `solpg` as the operator:

   ```sh
   cd client-v2
   CLOUD_SQL_INSTANCE="$PROJECT_ID:$REGION:solpg" CLOUD_SQL_USER="$PRODUCTION_DB_USER" \
     CLOUD_SQL_DATABASE=solpg scripts/db/cloud-sql/migration-url production -- dbmate --no-dump-schema up
   ```

3. `\dt` on `solpg` shows every table owned by the production user.
4. On Production, set the variables of step 6 (without `SYNC_ENABLED=false`), with `vercel env add <name>
   production`, and remove `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
5. Redeploy production. `GET /api/sync` answers `{ "enabled": true, "db": "ok" }`, and a sign-in and a project
   edit on the production domain write a row to `solpg`.
6. Return to the repository root with `cd ..`, then run `make -f client-v2/Makefile.vercel migrate-production-db`
   with `VERCEL_DEPLOY_PROJECT_ID` set to the ID of the project the Git integration deploys and the checkout linked
   to it ([Migrations](deploy-client-vercel.md#migrations)). It names `solpg` and reports nothing to apply.

From then on, `migrate-production-db` migrates `solpg`: it reads `DB_PROVIDER` and the `CLOUD_SQL_*` variables from
the Production environment it pulls, prints the database and instance, starts the proxy as `gcloud`'s active
account, lists the pending migrations, and applies them after a typed `yes`, under the production user's role. It
needs `cloud-sql-proxy` and `psql` installed and `gcloud` logged in as an operator. While Production's
`DB_PROVIDER` is `url` or unset, it migrates the production Neon project as before.

**Rollback:** restore `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and `DB_PROVIDER=url` on Production and redeploy.
The Neon project was not written to after the switch; rows written to `solpg` in between are lost.

## 8. Google Cloud: the preview instance

A small zonal instance. Public IP with no authorised network: only the connector front end answers, and it checks
the client certificate the connector or the proxy fetched for an IAM identity.

```sh
gcloud sql instances create solpg-preview \
  --database-version=POSTGRES_17 --edition=ENTERPRISE \
  --tier=db-custom-1-3840 --region="$REGION" --availability-type=ZONAL \
  --database-flags=cloudsql.iam_authentication=on \
  --connector-enforcement=REQUIRED --ssl-mode=ENCRYPTED_ONLY
```

## 9. Google Cloud: federation for GitHub Actions

The condition admits tokens from `REPO`'s workflows only; tokens from every other repository are refused at the
exchange.

```sh
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition="assertion.repository == '$REPO'"
```

## 10. Google Cloud: the preview service accounts and their bindings

Each service account may be impersonated by one subject only:

```sh
gcloud iam service-accounts create vercel-preview --display-name="Vercel Preview"
gcloud iam service-accounts create github-ci --display-name="GitHub Actions, preview databases"

POOL=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools
gcloud iam service-accounts add-iam-policy-binding "$PREVIEW_SA" --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/$POOL/vercel/subject/owner:$TEAM_SLUG:project:$VERCEL_PROJECT:environment:preview"
gcloud iam service-accounts add-iam-policy-binding "$CI_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL/github/attribute.repository/$REPO"
```

Then the Cloud SQL roles, with the helpers from step 4, each naming `solpg-preview` only:

```sh
grant "serviceAccount:$PREVIEW_SA" solpg-preview
grant "serviceAccount:$CI_SA" solpg-preview
grant "user:$OPERATOR" solpg-preview
```

## 11. Google Cloud: IAM database users on the preview instance

The operator who runs step 12 gets the `cloudsqlsuperuser` role, so the setup needs no password for the built-in
`postgres` user. An operator added later needs only membership of the application's role ([Adding an
operator](#adding-an-operator)).

```sh
gcloud sql users create "$PREVIEW_DB_USER" --instance=solpg-preview --type=cloud_iam_service_account
gcloud sql users create "$CI_DB_USER" --instance=solpg-preview --type=cloud_iam_service_account
gcloud sql users create "$OPERATOR" --instance=solpg-preview --type=cloud_iam_user \
  --database-roles=cloudsqlsuperuser
```

## 12. Postgres: roles and databases on the preview instance

Through the proxy, as the operator, as in step 5:

```sh
cloud-sql-proxy --auto-iam-authn --gcloud-auth --port 5434 "$PROJECT_ID:$REGION:solpg-preview" &
psql "postgres://$(printf %s "$OPERATOR" | sed 's/@/%40/')@127.0.0.1:5434/postgres?sslmode=disable"
```

```sql
-- The operator may then act as the application's role, and so create databases it owns
GRANT "vercel-preview@<project id>.iam" TO "<operator e-mail>";
-- github-ci reads solpg_preview, creates and drops PR databases owned by vercel-preview, and migrates as it
GRANT "vercel-preview@<project id>.iam" TO "github-ci@<project id>.iam";
ALTER ROLE "github-ci@<project id>.iam" CREATEDB;

CREATE DATABASE solpg_preview OWNER "vercel-preview@<project id>.iam";
```

On PostgreSQL 16 and later, `GRANT` of a role and `ALTER ROLE` need the `ADMIN` option on the target role. Whether
`cloudsqlsuperuser` holds it on the IAM users Cloud SQL creates is _unverified_. If either statement answers
`permission denied`, run it as the built-in `postgres` user instead: set a password with
`gcloud sql users set-password postgres --instance=solpg-preview --prompt-for-password`, use it for these
statements only, then set it again to a random value nobody records.

Stop the proxy (`kill %1`). The database is empty; step 15 migrates it.

## 13. GitHub: variables and the label

On `REPO`. None is a secret: a token from the federation goes only to `REPO`'s workflows.

```sh
gh variable set PREVIEW_REPOSITORY --repo "$REPO" --body "$REPO"
gh variable set PREVIEW_DB_PROVIDER --repo "$REPO" --body cloud-sql
gh variable set PREVIEW_CLOUD_SQL_INSTANCE --repo "$REPO" --body "$PROJECT_ID:$REGION:solpg-preview"
gh variable set PREVIEW_CLOUD_SQL_USER --repo "$REPO" --body "$PREVIEW_DB_USER"
gh variable set GCP_CI_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO" \
  --body "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github"
gh variable set GCP_CI_SERVICE_ACCOUNT --repo "$REPO" --body "$CI_SA"
gh label create preview --repo "$REPO" --description "Deploy a preview with its own database"
```

`preview.yml` also needs `VERCEL_TOKEN` (a secret), `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`
([Neon preview databases, Configuration](neon.md#configuration) lists where each comes from). While Neon is still
configured, `NEON_PROJECT_ID` and `NEON_API_KEY` may stay; with `PREVIEW_DB_PROVIDER=cloud-sql` the workflows do
not read them.

## 14. Vercel: the Preview environment

OIDC is already on from step 3. The Preview environment's variables, for every preview the Git integration builds:

```sh
add() { printf %s "$3" | npx vercel env add "$1" "$2" --force; }
add DB_PROVIDER preview cloud-sql
add CLOUD_SQL_INSTANCE preview "$PROJECT_ID:$REGION:solpg-preview"
add CLOUD_SQL_DATABASE preview solpg_preview
add CLOUD_SQL_USER preview "$PREVIEW_DB_USER"
add GCP_PROJECT_NUMBER preview "$PROJECT_NUMBER"
add GCP_WORKLOAD_IDENTITY_POOL_ID preview vercel
add GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID preview vercel
add GCP_SERVICE_ACCOUNT_EMAIL preview "$PREVIEW_SA"
npx vercel env rm DATABASE_URL preview --yes
```

Run from a directory linked to the project the Git integration deploys, which is not the staging project
`VERCEL_DEPLOY_PROJECT_ID` holds: `VERCEL_DEPLOY_PROJECT_ID=prj_… make vercel-link` with that project's ID
([Migrations](deploy-client-vercel.md#migrations)). For Preview the CLI may ask for a Git
branch; leave it empty, for every branch. The dashboard (Settings → Environment Variables) does the same. Leave `SYNC_ENABLED` off on
Preview until step 16 has seen the database answer.

## 15. Migrate the shared preview database

With this change on `master`, run Actions → preview-shared-db → Run workflow. It migrates `solpg_preview` as
`github-ci`. The run proves the GitHub federation, the IAM login, and the role
memberships from step 12 at once; a failure names the step that broke.

## 16. Check the previews

1. An unlabelled PR's preview answers `{ "enabled": false, "db": "ok" }` on `GET /api/sync`: the database answers,
   with sync still off.
2. Set `SYNC_ENABLED=true` on Preview (`add SYNC_ENABLED preview true`) and redeploy that PR's preview from the
   dashboard or with a new push. It answers `{ "enabled": true, "db": "ok" }`.

Then, with sync on:

- A PR labelled `preview` gets the comment naming `solpg_preview_pr_<n>`, and its preview answers
  `{ "enabled": true, "db": "ok" }`.
- Removing the label drops the database; the comment says so.
- A dry run of Actions → preview-sweep lists nothing for an open labelled PR and never lists `solpg_preview`.

## Adding an operator

For production migrations (`migrate-production-db`):

```sh
OPERATOR=<their google account e-mail, lower case>
grant "user:$OPERATOR" solpg
gcloud sql users create "$OPERATOR" --instance=solpg --type=cloud_iam_user
```

Then, through the proxy as an existing operator, on `solpg`:
`GRANT "vercel-production@<project id>.iam" TO "<their e-mail>";`. It needs what step 5's `GRANT` does, so the
note there on PostgreSQL 16 applies.

For previews as well:

```sh
grant "user:$OPERATOR" solpg-preview
gcloud sql users create "$OPERATOR" --instance=solpg-preview --type=cloud_iam_user
```

and on `solpg-preview`:

```sql
GRANT "vercel-preview@<project id>.iam" TO "<their e-mail>";
-- create-preview-db creates the database as the login user, for a laptop deploy with DB_PROVIDER=cloud-sql
ALTER ROLE "<their e-mail>" CREATEDB;
```

Both statements need what step 12's do. Removing an operator reverses each line: `REVOKE`,
`gcloud sql users delete`, and `gcloud projects remove-iam-policy-binding` with the same condition.

## Checks

Gate 1, no preview or CI identity on the production instance: every Cloud SQL binding of `vercel-preview` and
`github-ci` names `solpg-preview`.

```sh
for sa in "$PREVIEW_SA" "$CI_SA"; do
  gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:$sa AND bindings.role~^roles/cloudsql" \
    --format='table(bindings.role, bindings.condition.expression)'
done
```

Gate 2, only the production user connects to `solpg`: on `solpg` through the proxy, `\l solpg` shows `CONNECT`
for `vercel-production@<project id>.iam` and no entry for `PUBLIC`, and `\du` shows no member of that role other
than the operators.

The port is closed: `psql "host=<instance public ip> port=5432 user=postgres sslmode=require"` is refused, since
connector enforcement admits only the connector front end.
