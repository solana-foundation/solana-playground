# Production runbook: client-v2 on Vercel and Cloud SQL

How to set up `client-v2`'s production from nothing: the Vercel project, Postgres on Cloud SQL instance `solpg`,
and every service production uses (GitHub sign-in, the Nous Research model keys, Sentry, the Firewall, Doppler for
the environment variables), and then release it on the custom domain. This is for the team that runs the Google Cloud project and the
Vercel team. Nothing is deployed yet and no user data exists anywhere, so nothing is copied or migrated from an
older system: the database starts empty and the migrations create its schema.

Step 10 covers the build server (App Engine service `playground-server`, deployed by `.github/workflows/cicd.yml`):
it moves the server's releases and rollbacks from the GCP console to GitHub Actions, and its sign-in from a stored
key to OIDC. It does not depend on steps 1 to 9 and can run before or after them.

This page gives the order, the check after each step, and what to do when a check fails. Some commands live in
[Cloud SQL for client-v2](cloud-sql.md) ("cloud-sql.md" below), [Deploy the client to Vercel](deploy-client-vercel.md)
("deploy-client-vercel.md") and [Firewall](firewall.md); each step links the section it runs.

Alexander Anikeev (`alexander.anikeev@hoodies.team`) is the contact on the Hoodies side and
helps with setting this up.

## Values to have ready

The placeholders the steps use. They are inputs to the commands, not production variables: none goes into Doppler
or Vercel, and none is a secret. Have each ready before step 1; the table says which ones a step produces.

| Placeholder | What it is | Where to find it |
| --- | --- | --- |
| `<PROJECT_ID>` | The Google Cloud project that holds instance `solpg` | Cloud console, project picker |
| `<REGION>` | The region of `solpg`, for example `us-central1` | Your choice in step 2, or `gcloud sql instances describe solpg --project=<PROJECT_ID> --format='value(region)'` if the instance exists |
| `<TEAM_SLUG>` | The Vercel team that owns the production project | The path in the team's Vercel URL |
| `<VERCEL_PROJECT>` | The production Vercel project's name | Chosen in step 1 |
| `<VERCEL_PROJECT_ID>` | The same project's id, `prj_...` | Step 1: Vercel → the project → Settings → General |
| `<VERCEL_APP_DOMAIN>` | The project's `<name>.vercel.app` production domain, used until the release | Step 1: Vercel → the project → Settings → Domains |
| `<CUSTOM_DOMAIN>` | The launch domain, without `https://` | Your team |
| `<DOPPLER_PROJECT>`, `<DOPPLER_CONFIG>` | The Doppler project and config that hold production's variables, for example `solana-playground` and `prd` | Your team; created in step 1 if new |
| `<OPERATOR>` | The Google account of each person who runs migrations, lower case | Your team |
| `<GITHUB_OWNER>` | The GitHub organization that will own the production OAuth app | Your team |
| `<BUILD_SERVER_CONTACT>` | Whoever sets `PG_CLIENT_URLS` on the build server (App Engine) | Your team |
| `<BUILD_SERVER_URL>` | The build server's `https://` origin, the one whose `PG_CLIENT_URLS` lists production | `<BUILD_SERVER_CONTACT>` |
| `<NOUS_ACCOUNT>` | The Nous Research account whose credits the assistant spends | Your team |
| `<TOP_UP_OWNER>` | The person who adds Nous credits when the balance runs low. Nous has no auto top-up: an empty balance stops the assistant for everyone | Your team |
| `<SERVER_PROJECT_ID>` | The Google Cloud project that runs App Engine service `playground-server`, the value of the `PROJECT_ID` Actions secret. May be `<PROJECT_ID>` or another project | Step 10 says how to find it |
| `<SERVER_SA>` | The service account the server deploys as, the value of the `SERVICE_ACCOUNT` Actions secret | Step 10 says how to find it |

cloud-sql.md writes some of these in lower case inside SQL and commands: `<project id>` is `<PROJECT_ID>`,
`<operator e-mail>` is `<OPERATOR>`. Its "Values used below" also asks for `REPO`, which only the preview steps
read; production needs none.

Secret values (keys, tokens, client secrets) never go on this page, in a ticket, or in a message. Every
production variable lives in `<DOPPLER_CONFIG>`, which syncs to Vercel's Production environment; the
[environment table](#production-environment) says where each value comes from.

## Before you start

On the machine that runs the steps (macOS or Linux):

- `gcloud`, logged in as `<OPERATOR>` (`gcloud auth login`), with rights to administer IAM and Cloud SQL in
  `<PROJECT_ID>`.
- [`cloud-sql-proxy`](https://cloud.google.com/sql/docs/postgres/sql-proxy#install), `psql`, and `dbmate`
  ([client-v2/db/README.md](../db/README.md)).
- Node at the version in `client-v2/.nvmrc`, yarn 1, `jq`, `make`, `curl`, `git` and `openssl`. The production
  build installs Rust itself (`scripts/vercel-install.sh`) and takes about an hour the first time.
- A full clone (not `--depth`) of `solana-foundation/solana-playground`, on `master`, with
  `git submodule update --init`. Every command runs from the repository root of that checkout.

Accounts and access:

- Google Cloud: IAM and Cloud SQL administration in `<PROJECT_ID>`. For step 10, IAM administration in
  `<SERVER_PROJECT_ID>` and the right to manage its App Engine traffic.
- Doppler: write access to `<DOPPLER_PROJECT>`, and the right to add its Vercel integration.
- Vercel: a member of `<TEAM_SLUG>` who can create a project and edit its settings, environment variables,
  Deployment Protection, Domains and Firewall, and the team's Security settings. The team's plan: Enterprise, so
  the build can use the Enhanced build machine.
- GitHub: admin on `solana-foundation/solana-playground` (Actions secrets and variables, the Vercel GitHub app) and on
  `<GITHUB_OWNER>` (an OAuth app).
- Nous Research: `<NOUS_ACCOUNT>`'s dashboard, to create keys and their spend limits.
- Sentry: organization `solana-fndn` with a project `solana-playground`, and a token that may upload source maps
  to it. **Both slugs are fixed in code** (`scripts/upload-sourcemaps.mjs`): if your organization or project has
  another slug, stop and tell Alexander before step 5.
- DNS of `<CUSTOM_DOMAIN>` (step 9).

**Each new shell** starts by setting cloud-sql.md's ["Values used below"](cloud-sql.md#values-used-below): the
commands below read `$PROJECT_ID`, `$REGION`, `$OPERATOR`, `$PRODUCTION_DB_USER`, `$PRODUCTION_SA` and
`$PROJECT_NUMBER` from it.

To open `psql` on `solpg` as the operator, which several checks do, from any directory:

```sh
cloud-sql-proxy --auto-iam-authn --gcloud-auth --port 5434 "$PROJECT_ID:$REGION:solpg" &
psql "postgres://$(printf %s "$OPERATOR" | sed 's/@/%40/')@127.0.0.1:5434/solpg?sslmode=disable"
# afterwards: kill %1
```

## Order and gates

Run the steps in order. Three gates hold throughout:

1. **The Firewall (step 4) before the first deployment (step 7).** The first deployment already carries the model
   key, and the rate limits are what stop one client from spending a key's daily limit in a minute.
2. **The schema before the code.** `solpg` holds every migration before a deployment reads it (step 3), and from
   then on a pull request that adds a migration merges only after you have applied it
   ([Migrations](#migrations)).
3. **Alexander confirms that `master` is the launch code** before step 7. It includes foundation PR #141, which
   makes the assistant charge what Nous reports and read the Nous keys' spend limits. Without it the assistant still
   runs on Nous, but its per-user caps are counted at lower prices.

## Production environment

Every variable production reads, from `src/shared/config/server-env.mjs`, `src/shared/config/client-env.ts`,
`scripts/check-agent-env.mjs` and the build scripts. Set each in `<DOPPLER_CONFIG>`, never in Vercel by hand:
Doppler is the source, and its sync writes Vercel's **Production** environment. "In Doppler" is the secret's
visibility there. The sync's type is **Dynamic**, so an **Unmasked** secret reaches Vercel as a Config variable and a
**Masked** one as a Secret, whose value cannot be read back and which a local build pulls as empty. That is why the
values a local build or `migrate-production-db` reads are Unmasked even when they are tokens.

**`REACT_APP_*` values are inlined into the browser bundle and readable by every visitor. Nothing secret goes in
one.**

A production build fails without `PG_AI_API_KEY`, `AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`AUTH_BASE_URL`, the database variables of `DB_PROVIDER`, and `SENTRY_AUTH_TOKEN`
(`scripts/check-agent-env.mjs`, `scripts/upload-sourcemaps.mjs`), and says which one is missing.

### Database (Cloud SQL)

All Unmasked in Doppler: none is a secret, and `migrate-production-db` reads them from a pull.

| Variable | Value | Set in |
| --- | --- | --- |
| `DB_PROVIDER` | `cloud-sql` | Step 3 |
| `CLOUD_SQL_INSTANCE` | `<PROJECT_ID>:<REGION>:solpg` | Step 3 |
| `CLOUD_SQL_DATABASE` | `solpg`. In production the application refuses any other name | Step 3 |
| `CLOUD_SQL_USER` | `vercel-production@<PROJECT_ID>.iam` | Step 3 |
| `GCP_PROJECT_NUMBER` | `gcloud projects describe <PROJECT_ID> --format='value(projectNumber)'` | Step 3 |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | `vercel` | Step 3 |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | `vercel` | Step 3 |
| `GCP_SERVICE_ACCOUNT_EMAIL` | `vercel-production@<PROJECT_ID>.iam.gserviceaccount.com` | Step 3 |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Never: they belong to the Neon provider, which production does not use | |

### Sync and sign-in

| Variable | Value | In Doppler | Set in |
| --- | --- | --- | --- |
| `SYNC_ENABLED` | Exactly `true`. Anything else turns sync off | Unmasked | Step 6 |
| `AUTH_SECRET` | `openssl rand -base64 32`, generated for production and used nowhere else. Rotating it signs everyone out | Masked | Step 6 |
| `AUTH_BASE_URL` | `https://<VERCEL_APP_DOMAIN>`, then `https://<CUSTOM_DOMAIN>` from step 9. No trailing slash. Production accepts sign-in and writes from this origin only | Unmasked | Step 6, step 9 |
| `GITHUB_CLIENT_ID` | The production OAuth app's Client ID (step 5) | Unmasked | Step 6 |
| `GITHUB_CLIENT_SECRET` | The production OAuth app's client secret (step 5) | Masked | Step 6 |
| `AUTH_OAUTH_PROXY_SECRET`, `AUTH_OAUTH_PROXY_URL` | Never on Production: they let previews sign in through production, and this project has no previews | | |

### Assistant default backend (Nous Research)

The assistant runs on Nous Research, from `<NOUS_ACCOUNT>`'s credits, through the two keys created in step 5.
`PG_AI_BASE_URL` and `PG_AI_MODEL` stay unset: they default to Nous
(`https://inference-api.nousresearch.com/v1`, `z-ai/glm-5.3-flash:US`, a US-hosted model). Vercel AI Gateway is a
documented fallback for when the credits run out ([Default backend
spend](deploy-client-vercel.md#default-backend-spend)); do not set it up for the launch.

| Variable | Value | In Doppler | Set in |
| --- | --- | --- | --- |
| `PG_AI_API_KEY` | The Nous `established` key | Masked | Step 6 |
| `PG_AI_NEWCOMER_API_KEY` | The Nous `newcomer` key. Unset, new GitHub accounts spend through `PG_AI_API_KEY` and share the established users' limit | Masked | Step 6 |
| `PG_AI_BASE_URL`, `PG_AI_MODEL` | Leave unset (Nous) | Unmasked | |
| `PG_AI_REASONING_EFFORT`, `PG_AI_PROVIDERS`, `PG_AI_PRICE_INPUT`, `PG_AI_PRICE_OUTPUT`, `PG_AI_MAX_BODY_BYTES`, `PG_AI_MAX_OUTPUT_TOKENS`, `PG_AI_NEWCOMER_AGE_DAYS`, `PG_AI_NEWCOMER_DAILY_CAP`, `PG_AI_ESTABLISHED_DAILY_CAP` | Leave unset. Each defaults as `agentEnv` in `src/shared/config/server-env.mjs` sets it: a user may spend $0.10 a day while their GitHub account is younger than 30 days, $0.50 after | Unmasked | |
| Any `AGENT_*` | Never: the deprecated spelling of `PG_AI_*` | | |
| `SOURCES`, `MCP_EXPLORER_URL`, `MCP_EXPLORER_TOKEN`, `MCP_EXPLORER_BYPASS` | Leave unset unless told otherwise ([Sources catalogue](deploy-client-vercel.md#sources-catalogue)) | Token and bypass: Masked | |

### Observability

| Variable | Value | In Doppler | Set in |
| --- | --- | --- | --- |
| `REACT_APP_SENTRY_DSN` | The DSN of Sentry project `solana-playground` in organization `solana-fndn`. Public: the browser and the functions share it | Unmasked | Step 6 |
| `SENTRY_AUTH_TOKEN` | A Sentry auth token that may upload source maps to that project. Read by the build only | **Unmasked**: a local build pulls a Vercel Secret as empty, and then fails | Step 6 |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` to `1`. Unset traces every API request | Unmasked | |
| `SENTRY_PREVIEW_ENABLED`, `SOURCEMAPS_PREVIEW_ENABLED` | Never on Production: Preview only | | |
| `REACT_APP_GA_MEASUREMENT_ID` | `G-...`, the Google Analytics 4 measurement id, if the Foundation uses Google Analytics. Unset, the page carries no tag | Unmasked | Step 6 |
| `REACT_APP_LOG_LEVEL` | Unset logs `warn` in production | Unmasked | |

### Solana RPC and deploys

Optional. Without them the app uses the public Solana endpoints.

| Variable | Value | In Doppler | Set in |
| --- | --- | --- | --- |
| `REACT_APP_DEVNET_RPC_URL`, `REACT_APP_TESTNET_RPC_URL`, `REACT_APP_MAINNET_RPC_URL` | The RPC provider's URLs (Triton), **only if the provider restricts the keys in them to `<VERCEL_APP_DOMAIN>` and `<CUSTOM_DOMAIN>`**: every visitor can read them. Without that restriction leave them unset | Unmasked (public by design) | Step 6 |
| `REACT_APP_DEVNET_READ_BUFFER_RPC_URL`, `REACT_APP_TESTNET_READ_BUFFER_RPC_URL`, `REACT_APP_MAINNET_READ_BUFFER_RPC_URL` | The RPC a program deploy reads its buffer account through, because a provider's RPC can answer `null` for a buffer just written. **Set them whenever the RPC URLs above are set**: `https://api.devnet.solana.com`, `https://api.testnet.solana.com`, `https://api.mainnet-beta.solana.com`. Unset, deploys read through the selected endpoint | Unmasked | Step 6 |
| `REACT_APP_DEVNET_SEND_TX_PER_SECOND`, `REACT_APP_TESTNET_SEND_TX_PER_SECOND`, `REACT_APP_MAINNET_SEND_TX_PER_SECOND` | Optional. The most buffer writes per second a deploy sends, just below the RPC plan's `sendTransaction` limit. Unset, 4 a second | Unmasked | |

### Build and platform

| Variable | Value | In Doppler | Set in |
| --- | --- | --- | --- |
| `REACT_APP_SERVER_URL` | `<BUILD_SERVER_URL>`, no trailing slash. **Required**: the build server every profile starts on | Unmasked | Step 6 |
| `REACT_APP_SERVER_UNSTABLE` | Never `true`: a Vercel build with it fails | | |
| `REACT_APP_VERCEL_ENV`, `REACT_APP_VERCEL_GIT_COMMIT_SHA` | Never: `scripts/vercel-build.sh` sets both | | |
| `USE_WASM_STUBS` | Never: a deployment with it fails its install (`scripts/vercel-install.sh`) | | |
| `VERCEL_ENV` and Vercel's other system variables | Never as a project variable: Vercel sets them, see step 1 | | |

### Outside Vercel

| Where | Name | Value | Set in |
| --- | --- | --- | --- |
| `client-v2/.env` in your checkout (gitignored) | `VERCEL_DEPLOY_TEAM`, `VERCEL_DEPLOY_PROJECT_ID` | `<TEAM_SLUG>` and `<VERCEL_PROJECT_ID>`. Every Makefile target refuses a checkout linked to another project | Step 1 |
| GitHub, `solana-foundation/solana-playground` → Settings → Secrets and variables → Actions → Repository secrets | `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel → the project → Settings → Deployment Protection → Protection Bypass for Automation. **Why:** after each push to `master`, the `smoke` job of `.github/workflows/client-v2.yml` waits for that commit's production deployment and calls `GET /api/sync` on the deployment's own URL, which Deployment Protection hides; the job sends this secret to get past it. The run fails unless production answers `{"enabled":true,"db":"ok"}`, so a production that cannot reach its database shows as a red run. Without the secret the job passes with a warning and checks nothing | Step 8 |
| GitHub, the same page → Variables → Repository variables | `GCP_WORKLOAD_IDENTITY_PROVIDER` | The full resource name of the server's Workload Identity provider. Set, the server's deploys and releases sign in to GCP through OIDC; empty, through the `GCP_KEY` secret. The secrets `GCP_KEY`, `SERVICE_ACCOUNT` and `PROJECT_ID` already exist there | Step 10 |
| The build server's environment | `PG_CLIENT_URLS` | Must include `https://<VERCEL_APP_DOMAIN>` and, from step 9, `https://<CUSTOM_DOMAIN>`, or the browser's build requests are refused by CORS | Before step 7; step 9 |

## Step 1: the Vercel project

**What for:** the project production deploys to, and a checkout linked to it.

**Run:**

1. Create the project in `<TEAM_SLUG>` from `solana-foundation/solana-playground`
   ([deploy-client-vercel.md, "One-time setup"](deploy-client-vercel.md#one-time-setup) steps 1 to 3): Framework
   Preset **Other**, Root Directory **`client-v2`**, Production Branch **`master`**, Build Machine **Enhanced**.
   Leave the build and install commands empty: `client-v2/vercel.json` sets them. The import starts a first build;
   let it run, since its log answers the Remote Cache check below. It then fails or times out, which is expected:
   the project has no variables yet.
2. Settings → Functions: Function Region nearest `<REGION>` (each database query crosses that distance), and Fluid
   compute on.
3. Settings → Security → Secure backend access with OIDC Federation: enabled, issuer mode **Team**
   ([cloud-sql.md, step 3](cloud-sql.md#3-vercel-oidc)).
4. Settings → Environment Variables: **Automatically expose System Environment Variables** on. The application
   decides by `VERCEL_ENV` which database it may open, and the build by `VERCEL_ENV` whether to report to Sentry.
5. Team Settings → Security: **Enforce Sensitive Environment Variables** off, or at least not covering this
   project's Production. With it on, `SENTRY_AUTH_TOKEN` and the database variables become Secrets, a local build
   pulls them as empty, and the production build and `migrate-production-db` fail.
6. Settings → Deployment Protection → Protection Bypass for Automation: create the secret. The CI smoke check uses
   it ([Outside Vercel](#outside-vercel) says how); it goes on GitHub in step 8 and stays readable on this settings
   page.
7. Note `<VERCEL_PROJECT_ID>` (Settings → General) and `<VERCEL_APP_DOMAIN>` (Settings → Domains).
8. **Doppler.** Create `<DOPPLER_PROJECT>` and `<DOPPLER_CONFIG>` if they do not exist. In the project,
   Integrations → Vercel: authorize Doppler's Vercel app, then Setup Integration with Team `<TEAM_SLUG>`, project
   `<VERCEL_PROJECT>`, Vercel environment **Production**, variable type **Dynamic**, config `<DOPPLER_CONFIG>`. Leave
   its redeploy on sync off until step 8: every value saved in steps 3 to 6 would otherwise start a build before
   the checked one in step 7. One integration only: this project has no Preview or Development variables. Never
   sync a variable named in Doppler's reserved list (`AWS_*`, `TZ` and the others on
   [its Vercel page](https://docs.doppler.com/docs/vercel)); none of ours is.
9. In your checkout, put `VERCEL_DEPLOY_TEAM=<TEAM_SLUG>` and `VERCEL_DEPLOY_PROJECT_ID=<VERCEL_PROJECT_ID>` in
   `client-v2/.env` (create the file if missing; it is gitignored). Then, from the repository root:

   ```sh
   make vercel-login
   make vercel-link
   make vercel-auth
   ```

   `vercel-link` prints `Linked Vercel project: <VERCEL_PROJECT_ID> in team ...`; `vercel-auth` prints
   `Vercel CLI user: <you>`. The CLI version is the one pinned as `VERCEL_CLI` in `client-v2/Makefile.vercel`; use
   that version wherever this page says `npx vercel@62.7.0`.

**Check:**

1. Doppler's Integrations page lists the Vercel sync for Production, and `npx vercel@62.7.0 env ls production`
   runs and lists only what `<DOPPLER_CONFIG>` already holds (nothing, if it is new).
2. **Remote Cache.** The import build's log (Deployments → the build → Building) prints, within its first minutes,
   `>>> Remote Cache: VERCEL_ARTIFACTS_TOKEN set` and `>>> Remote Cache: VERCEL_ARTIFACTS_OWNER set`. These are the
   credentials Vercel gives a build for its Remote Cache. A build on Vercel compiles the wasm packages (Rust to
   WebAssembly, about an hour), which does not fit in Vercel's build time limit; with the credentials it stores the
   compiled packages there and later builds reuse them, so a push to `master` can deploy (step 8). If either line
   says `unset`, builds on Vercel never finish: tell Alexander, and deploy with the local build of step 7 until it
   is fixed. The two lines prove only that the credentials are there, not that the cache holds the packages: step
   8's check 3 proves that.

## Step 2: Google Cloud and Cloud SQL

Ticket HOO-1735.

**What for:** the instance, and the identity production connects as. Vercel's OIDC token is exchanged through
Workload Identity Federation for the service account `vercel-production`, which logs in to Postgres with IAM;
there is no database password or key anywhere.

**Run:** [cloud-sql.md](cloud-sql.md), "Values used below", then steps 1, 2, 4 and 5, in one shell (step 4 defines
helpers that step 5 uses). Step 3 was done in step 1. Step 5 creates `solpg` if it does not exist.

**Check**, with the commands in [cloud-sql.md, "Checks"](cloud-sql.md#checks):

1. `gcloud sql instances describe solpg ...` shows `cloudsql.iam_authentication` `on`, `connectorEnforcement:
   REQUIRED`, `sslMode: ENCRYPTED_ONLY`, and no `authorizedNetworks`.
2. `\l solpg` through the proxy shows `CONNECT` for `vercel-production@<PROJECT_ID>.iam` and none for `PUBLIC`;
   `\drg` (psql 16 and later; `\du` before) shows no member of that role other than the operators.
3. `psql` straight to the instance's public IP on port 5432 never reaches a password prompt.

**If a check fails:** nothing reads `solpg` yet, so fix and run the step again. A `GRANT` that answers
`permission denied` has its own fix in step 5 of cloud-sql.md. A proxy that does not start prints its log: usually
`gcloud` is logged in as someone without the Cloud SQL roles step 5 grants.

## Step 3: the database variables and the schema

**What for:** production's database settings on Vercel, and the schema in `solpg`, applied the way every later
migration will be.

**Run:**

1. Set each variable of [Database (Cloud SQL)](#database-cloud-sql) in `<DOPPLER_CONFIG>`, Unmasked, with the
   values the table gives (`echo "$PROJECT_ID:$REGION:solpg" "$PRODUCTION_DB_USER" "$PROJECT_NUMBER" "$PRODUCTION_SA"`
   prints the four that vary). Check that the sync wrote them: `npx vercel@62.7.0 env ls production` lists all eight,
   and the dashboard shows none with the Secret badge.

2. Apply every migration:

   ```sh
   make migrate-production-db
   ```

   It pulls Production's variables, prints `production database: solpg on Cloud SQL instance <PROJECT_ID>:<REGION>:solpg`,
   starts the proxy as `gcloud`'s active account, lists every file in `client-v2/db/migrations` as pending, and
   applies them after a typed `yes`, as the production user's role.

**Check:**

1. `make migrate-production-db` again prints `nothing to apply`.
2. `\dt` on `solpg` through the proxy lists the tables, every one owned by `vercel-production@<PROJECT_ID>.iam`.

**If a check fails:** `Production's DB_PROVIDER is cloud-sql, but ... is not set there` names a variable that
item 1 missed. `no DATABASE_URL_UNPOOLED in the Production environment` means the pull did not see `DB_PROVIDER`:
check the Doppler sync and `npx vercel@62.7.0 env ls production`. A variable that is there but pulled empty was
synced as a Secret: make it Unmasked in Doppler. A migration that fails midway can be run again: dbmate records
each one it finished in `schema_migrations`. If the schema is wrong, start `solpg` again as
[cloud-sql.md, step 5](cloud-sql.md#5-google-cloud-the-production-instance) says under "Starting `solpg` again" (drop,
create, `REVOKE`), run item 2 again, then check 2 of step 2; nothing depends on it yet.

## Step 4: Firewall

Ticket HOO-2412.

**What for:** a rate limit per client on the routes that spend money or open a database connection, and an emergency
switch that turns the assistant off without a redeploy.

**Run:** [firewall.md](firewall.md): "Before configuring", then every rule under "Rules to configure", including
`Rate limit /api/ai/status (IP)` and the two `[EMERGENCY]` rules, which are created **disabled**. Publish. The rules
cover every domain of the project, so they hold after the release without change.

**Check:** the Firewall tab lists each rule under its name, and `[EMERGENCY] Deny /api/agent` and
`[EMERGENCY] Rate limit /api/agent (JA4)` as Disabled. The rules are tested against the deployment in step 7.

**Rollback:** disable a rule and publish. The Firewall's Audit Log lists every change.

## Step 5: accounts, keys and secrets

Tickets HOO-1745, HOO-1795, HOO-1796, HOO-1801.

**What for:** every credential production uses, each stored in `<DOPPLER_CONFIG>` under its variable name the
moment you have it (a Nous key is shown once, at creation), with the visibility the
[environment table](#production-environment) gives. Each syncs to Vercel as you save it; nothing reads it until the
first deployment in step 7. Give write access to `<DOPPLER_CONFIG>` only to the people who rotate them.

**Run:**

1. **GitHub OAuth app.** In `<GITHUB_OWNER>` → Settings → Developer settings → OAuth Apps → New OAuth App: Homepage
   URL `https://<VERCEL_APP_DOMAIN>`, Authorization callback URL
   `https://<VERCEL_APP_DOMAIN>/api/auth/callback/github`. Generate a client secret. Store it as
   `GITHUB_CLIENT_SECRET`; the Client ID goes in as `GITHUB_CLIENT_ID` in step 6.
2. **`AUTH_SECRET`.** `openssl rand -base64 32`. Store it as `AUTH_SECRET`.
3. **Nous keys.** In `<NOUS_ACCOUNT>`'s dashboard, create two keys, each with a daily and a monthly spend limit:

   | Key | Daily limit | Monthly limit | Goes into |
   | --- | --- | --- | --- |
   | `established` | $50 | $1,250 | `PG_AI_API_KEY` |
   | `newcomer` | $10 | $250 | `PG_AI_NEWCOMER_API_KEY` |

   Store them as `PG_AI_API_KEY` and `PG_AI_NEWCOMER_API_KEY`. The limits are the ceiling on what the assistant can spend, whatever the application does; past one,
   Nous refuses the key and the assistant answers that it is unavailable. The daily limit is a rolling window that
   starts with the key's first request. Note the balance, and show `<TOP_UP_OWNER>` where to read it: Nous has no
   auto top-up and no API for the balance.
4. **Sentry.** In organization `solana-fndn`, project `solana-playground` (platform React; create it if missing):
   copy the DSN (Project Settings → Client Keys), and create an auth token that may upload source maps (Organization
   Settings → Auth Tokens). Store the token as `SENTRY_AUTH_TOKEN`, **Unmasked** (a local build reads it); the DSN
   goes in as `REACT_APP_SENTRY_DSN` in step 6.
5. **Optional:** a Google Analytics 4 property and its measurement id (`G-...`); the RPC provider's URLs, restricted
   to `<VERCEL_APP_DOMAIN>` and `<CUSTOM_DOMAIN>`, and its `sendTransaction` limit. They go in in step 6.

**Check:** in Vercel → Settings → Environment Variables, Production, `AUTH_SECRET`, `GITHUB_CLIENT_SECRET`,
`PG_AI_API_KEY` and `PG_AI_NEWCOMER_API_KEY` carry the Secret badge, and
`SENTRY_AUTH_TOKEN` does not.

## Step 6: the production environment

**What for:** every remaining variable in [Production environment](#production-environment).

**Preconditions:** steps 1 to 5 pass.

**Run:** set each variable the tables mark "Step 6" in `<DOPPLER_CONFIG>`, with the visibility in its "In Doppler"
column. `AUTH_BASE_URL` is `https://<VERCEL_APP_DOMAIN>` for now.

Then ask `<BUILD_SERVER_CONTACT>` to add `https://<VERCEL_APP_DOMAIN>` to `PG_CLIENT_URLS` on the build server.

**Check:** `npx vercel@62.7.0 env ls production` lists the step 3 variables, `SYNC_ENABLED`, `AUTH_SECRET`,
`AUTH_BASE_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `PG_AI_API_KEY`, `PG_AI_NEWCOMER_API_KEY`,
`REACT_APP_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` and `REACT_APP_SERVER_URL`, plus any optional ones you set,
with no `AGENT_*`, `DATABASE_URL` or `AUTH_OAUTH_PROXY_*` name. Only the Masked ones carry the Secret badge in the
dashboard.

## Step 7: the first production deployment

**What for:** production running on `https://<VERCEL_APP_DOMAIN>`, checked end to end before anyone is told about it.

**Preconditions:** gates 1 to 3 in [Order and gates](#order-and-gates) hold; `PG_CLIENT_URLS` includes
`https://<VERCEL_APP_DOMAIN>`.

**Run:** a full local build and deploy, from the repository root on `master`:

```sh
make deploy-client-to-vercel-production
```

It pulls Production's variables, prints the commit, asks for a typed `yes`, builds (about an hour the first time)
and deploys to the production domain.

**Why a local build:** the first build has to compile the wasm packages, and on Vercel that takes longer than its
build time limit allows, so it would fail. A local build has no limit. Once Remote Cache holds the compiled
packages (step 8, check 3), builds on Vercel reuse them and finish, and from step 8 a push to `master` deploys
production without this command ([Deploying production](#deploying-production)).

**Check:**

1. The build log has none of these lines: `check-agent-env: deprecated AGENT_* names still set`,
   `warning: SENTRY_AUTH_TOKEN is not set`, `warning: source maps: upload failed`. A line
   `check-agent-env: ... empty here` is expected on a local build: it names the Masked variables the pull held as
   empty.
2. `curl -s https://<VERCEL_APP_DOMAIN>/api/sync` answers `{"enabled":true,"db":"ok"}`. The instance's log
   (Logs Explorer, resource Cloud SQL Database, search `vercel-production`) shows the production user logging in.
3. `curl -s https://<VERCEL_APP_DOMAIN>/api/ai/status`, signed out, answers
   `{"available":false,"key":"hosted","reason":"signed-out","model":"z-ai/glm-5.3-flash:US"}`.
4. Sign in on `https://<VERCEL_APP_DOMAIN>` with GitHub, create a project and edit a file; in a second browser
   signed in to the same account, the edit appears. Through the proxy on `solpg`, `select count(*) from "user";`
   and `select count(*) from project_files;` both answer more than `0`.
5. The assistant answers a question on the default backend, and the Nous dashboard shows spend on the `newcomer`
   or `established` key.
6. **The newcomer cap.** Signed in with a GitHub account created less than 30 days ago, send turns on the default
   backend until the chat says "You have used today's free assistant allowance. It resets at 00:00 UTC, or bring
   your own key to keep going." That takes about 13 turns, $0.10 in all. Through the proxy on `solpg`:

   ```sql
   select sum(charged) / 1e6 as usd, count(*) as turns
   from agent_turn
   where user_id = (select "userId" from account
                    where "providerId" = 'github' and "accountId" = '<numeric GitHub id of the account>')
     and day = (now() at time zone 'utc')::date;
   ```

   The numeric id is in `https://api.github.com/users/<login>`. `usd` should match the `newcomer` key's spend in the
   Nous dashboard for the same turns, to within a cent.
7. The Firewall, from one machine, with the loop in [firewall.md, "Verifying"](firewall.md#verifying) against
   `https://<VERCEL_APP_DOMAIN>`: `/api/agent` answers `429` with an `x-vercel-mitigated` header after 30 requests;
   `/api/ai/status` (`seq 1 70`) after 60; `/api/auth/sign-in/social` (`seq 1 30`) after 20. Report the last one
   either way: it shows whether the firewall matches the path before `vercel.json` rewrites it. Your IP stays
   limited for up to 60 seconds afterwards.
8. Sentry, project `solana-playground`, environment `production`:
   - **The browser.** On `https://<VERCEL_APP_DOMAIN>`, open the browser's developer console and run
     `setTimeout(() => { throw new Error("sentry check: browser") })`. The app reports any uncaught error, so within a
     minute Issues lists `Error: sentry check: browser`. Resolve it afterwards.
   - **The functions.** Traces lists `GET /api/sync` spans from the requests of check 2: every API function sends a
     span per request while `SENTRY_TRACES_SAMPLE_RATE` is unset.
9. With RPC URLs set: Settings › Network offers Mainnet, Devnet and Testnet on your provider's URLs, and a program
   deploy to Devnet completes.
10. `make migrate-production-db` prints `nothing to apply`.

**If a check fails:**

- A failed build prints `check-agent-env: <what is missing>` or the Sentry upload error, naming the variable.
- `"db":"unconfigured"`: a step 3 variable is missing or misspelt.
- `"db":"unreachable"`: the token exchange or the login failed. The deployment's function log (Deployments → the
  deployment → Logs, filter `/api/sync`) names the cause. A line starting `db: refusing` names the instance or
  database the application refused. Otherwise compare, in order: OIDC issuer mode Team; the subject in cloud-sql.md
  step 4's binding (`owner:<TEAM_SLUG>:project:<VERCEL_PROJECT>:environment:production`); the two roles on `solpg`;
  the IAM database user.
- Sign-in failing at GitHub with "The redirect_uri is not associated with this application": the OAuth app's
  callback URL and `AUTH_BASE_URL` disagree. Writes answering `403`: the page is open on another hostname than
  `AUTH_BASE_URL`.
- A turn answered `502` is logged as `agent: upstream refused the default backend`: the key is wrong, or
  `PG_AI_BASE_URL` is set to something other than Nous.
- Builds failing in the browser with a CORS error: `PG_CLIENT_URLS`.

Fix the cause and deploy again; no one uses the domain yet.

## Step 8: deploys from `master`, and the smoke check

**What for:** a push to `master` deploys production through Vercel's Git integration, and a CI job checks the
result.

**Run:**

1. The project's Git connection (Settings → Git) names `solana-foundation/solana-playground`, Production Branch
   `master`.
2. On GitHub, add the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET` with the bypass secret from step 1
   ([Outside Vercel](#outside-vercel)).
3. In Doppler, turn on the Vercel sync's redeploy on sync. From now on a change in `<DOPPLER_CONFIG>` redeploys
   production.

**Check**, after the next merge to `master`:

1. The repository's Settings → Environments lists `Production`. If it lists `Production – <VERCEL_PROJECT>` instead
   (Vercel names it so when more than one project builds this repository), tell Alexander: the smoke job looks for
   `Production`.
2. The `smoke` job of that push's `client-v2` run passes and its summary shows `{"enabled":true,"db":"ok"}`. A Git
   build that times out fails the job, and production keeps the deployment it had ([Deploying
   production](#deploying-production)).
3. **Remote Cache holds the packages.** That push's build log (Deployments → the build → Building) prints
   `>>> wasm packages: HIT in Remote Cache` or `HIT in Build Cache`, and the same for `>>> default crates:`. A
   `MISS in Build Cache and Remote Cache` line means the cache was empty: that build compiles the packages and
   uploads them before it can time out, so the next push's build should print `HIT`. A line
   `Remote Cache upload failed` means it did not store them: tell Alexander. Until a build prints both `HIT` lines,
   deploy each merge to `master` with step 7's command.

## Step 9: release on the custom domain

Ticket HOO-2537.

**Preconditions:** steps 7 and 8 pass, and Alexander has accepted his checks on `<VERCEL_APP_DOMAIN>`.

**Run:**

1. Ask `<BUILD_SERVER_CONTACT>` to add `https://<CUSTOM_DOMAIN>` to `PG_CLIENT_URLS`.
2. Set the OAuth app's Homepage URL to `https://<CUSTOM_DOMAIN>` and its callback URL to
   `https://<CUSTOM_DOMAIN>/api/auth/callback/github`.
3. Set `AUTH_BASE_URL` to `https://<CUSTOM_DOMAIN>` in `<DOPPLER_CONFIG>`.
4. Attach `<CUSTOM_DOMAIN>` (Settings → Domains) and create the DNS records Vercel shows.
5. Doppler's sync redeploys. Check that a new production deployment appears in Deployments and goes Ready; if none
   does, redeploy as in [Deploying production](#deploying-production).

**Check:**

1. `curl -s https://<CUSTOM_DOMAIN>/api/sync` answers `{"enabled":true,"db":"ok"}`.
2. `curl -s https://<CUSTOM_DOMAIN>/api/ai/status` answers as in step 7's check 3.
3. Sign in on `https://<CUSTOM_DOMAIN>`, edit a project, and ask the assistant a question.

A sign-in on `<VERCEL_APP_DOMAIN>` is now refused at GitHub, and its writes answer `403`: production accepts one
origin, `AUTH_BASE_URL`. The accounts and projects created while testing stay in `solpg`.

**If a check fails:** as in step 7. **Rollback:** point the OAuth app and `AUTH_BASE_URL` back at
`<VERCEL_APP_DOMAIN>`, remove the domain, and redeploy.

## Step 10: the build server's releases and its sign-in to GCP

Ticket HOO-484. How the two workflows behave is in [Server release](../../docs/server-release.md).

**What for:** today a tagged commit on `master` parks a new server version with no traffic, and someone with
console rights moves traffic to it, or back, in the GCP console. The deploy signs in with `GCP_KEY`, a
service-account JSON key that never expires and that any workflow file on any branch can read. After this step:

- **Actions → Server release → Run workflow** on `master` sends all of `playground-server`'s traffic to a named
  version, or rolls back to the one before, and checks that the move took.
- Both that workflow and the deploy sign in through Workload Identity Federation (OIDC), with a short-lived token
  that only `master` of this repository can get. The key is deleted.

**Preconditions:** none of steps 1 to 9. Until `GCP_WORKLOAD_IDENTITY_PROVIDER` is set, both workflows keep
signing in with `GCP_KEY`, so the Server release workflow already works on the key; items 1 to 4 below move it to
OIDC.

**Run**, in one shell:

1. **Find the two values.** The Actions secrets cannot be read back, so find them in GCP. `<SERVER_PROJECT_ID>` is
   the project whose App Engine lists the service (`gcloud app services list --project=<id>` shows
   `playground-server`). `<SERVER_SA>` is the `client_email` in the JSON key stored as `GCP_KEY`; without the file,
   it is the account with a user-managed key among
   `gcloud iam service-accounts list --project=<SERVER_PROJECT_ID>` (check each with
   `gcloud iam service-accounts keys list --iam-account=<email> --managed-by=user`). If more than one account has a
   key, tell Alexander before going on.

   ```sh
   SERVER_PROJECT_ID=<SERVER_PROJECT_ID>
   SERVER_SA=<SERVER_SA>
   REPO_ID=1003072868   # solana-foundation/solana-playground; check: gh api repos/solana-foundation/solana-playground --jq .id
   ```

2. **Let the account move traffic.** Deploying needs only `roles/appengine.deployer`, which cannot move traffic.
   List the account's roles:

   ```sh
   gcloud projects get-iam-policy "$SERVER_PROJECT_ID" --flatten=bindings \
     --filter="bindings.members:serviceAccount:$SERVER_SA" --format='value(bindings.role)'
   ```

   Unless the list has `roles/appengine.serviceAdmin`, `roles/appengine.appAdmin`, `roles/editor` or
   `roles/owner`, grant the first:

   ```sh
   gcloud projects add-iam-policy-binding "$SERVER_PROJECT_ID" \
     --member="serviceAccount:$SERVER_SA" --role=roles/appengine.serviceAdmin --condition=None
   ```

   **When `<SERVER_PROJECT_ID>` is `<PROJECT_ID>`**, the account must hold no role that reaches Cloud SQL, because
   item 3 lets every workflow run on `master` act as it: no `roles/editor`, `roles/owner` or `roles/cloudsql.*`
   (cloud-sql's Gate 1: no CI identity on the production instance). If the list shows any of them, grant what
   deploying and moving traffic need instead, before removing anything:

   ```sh
   for role in roles/appengine.deployer roles/appengine.serviceAdmin roles/cloudbuild.builds.editor \
     roles/storage.objectAdmin roles/artifactregistry.writer; do
     gcloud projects add-iam-policy-binding "$SERVER_PROJECT_ID" \
       --member="serviceAccount:$SERVER_SA" --role="$role" --condition=None
   done
   RUNTIME_SA=$(gcloud app describe --project="$SERVER_PROJECT_ID" --format='value(serviceAccount)')
   gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project="$SERVER_PROJECT_ID" \
     --member="serviceAccount:$SERVER_SA" --role=roles/iam.serviceAccountUser
   ```

   Then remove `roles/editor`, `roles/owner` and any `roles/cloudsql.*` from the account, each with
   `gcloud projects remove-iam-policy-binding "$SERVER_PROJECT_ID" --member="serviceAccount:$SERVER_SA" --role=<role>`.
   Remove them now, before the checks: while a broad role stays, a deploy succeeds whatever the narrow roles lack,
   so check 3 would prove nothing. Checks 1 and 2 then prove the traffic role, and check 3 the deploy roles. If
   check 3's deploy fails on a permission, its log names the one missing: grant it (never a Cloud SQL role) and
   re-run the failed CICD job. If a release cannot wait for that, grant `roles/editor` back, release, and remove it
   again. A different project holds no Cloud SQL instance of ours, so this paragraph does not apply there.

3. **Create the pool and provider.** The pool is `github-server`, not `github`: cloud-sql.md's step 9 creates a
   `github` pool for previews, and the two may share a project. The condition admits tokens from `master` of this
   repository only, by its id, which a rename cannot take over.

   ```sh
   gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project="$SERVER_PROJECT_ID"

   gcloud iam workload-identity-pools create github-server \
     --project="$SERVER_PROJECT_ID" --location=global \
     --display-name="GitHub Actions: server"

   gcloud iam workload-identity-pools providers create-oidc solana-playground \
     --project="$SERVER_PROJECT_ID" --location=global \
     --workload-identity-pool=github-server \
     --display-name="solana-playground" \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
     --attribute-condition="assertion.repository_id == '$REPO_ID' && assertion.ref == 'refs/heads/master'"

   POOL=$(gcloud iam workload-identity-pools describe github-server \
     --project="$SERVER_PROJECT_ID" --location=global --format='value(name)')

   gcloud iam service-accounts add-iam-policy-binding "$SERVER_SA" \
     --project="$SERVER_PROJECT_ID" \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/$POOL/attribute.repository_id/$REPO_ID"

   gcloud iam workload-identity-pools providers describe solana-playground \
     --project="$SERVER_PROJECT_ID" --location=global \
     --workload-identity-pool=github-server --format='value(name)'
   ```

   The last command prints `projects/<number>/locations/global/workloadIdentityPools/github-server/providers/solana-playground`.

4. **Switch the workflows to OIDC.** On GitHub, add that output as the repository variable
   `GCP_WORKLOAD_IDENTITY_PROVIDER` ([Outside Vercel](#outside-vercel)). From now on a CICD or Server release run
   dispatched from any branch but `master` gets no token and fails; run both from `master`.

**Check:**

1. **OIDC, with nothing moving.** Find the live version:
   `gcloud app versions list --service=playground-server --hide-no-traffic --project="$SERVER_PROJECT_ID"` lists it
   with `TRAFFIC_SPLIT` `1.00` (more than one row: traffic is split; name the version that should have it all in
   the next run). Run **Server release** on `master` with that version as `version`. The run is green, its annotations
   say `GCP sign-in: Workload Identity Federation`, and its summary says the version `was already live; traffic not
   changed`.
2. **A rollback and back**, if an older version is still serving
   (`gcloud app versions list --service=playground-server --project="$SERVER_PROJECT_ID"`). Run Server release with
   `version` empty: the summary names the live version before and an older one as the target, and says the target
   holds all traffic. Then run it with the version that was live, and check the same. Each move switches the build
   server for every user, so do it when a minute of the older version does no harm. With no older serving version,
   skip this check; the next release proves the move.
3. **The next release.** After the next tagged commit on `master`, the CICD run's annotations say
   `GCP sign-in: Workload Identity Federation` and the new version appears, parked, in the version list. Move
   traffic to it as [Releasing the build server](#releasing-the-build-server) says.
4. **No route to `solpg`**, when `<SERVER_PROJECT_ID>` is `<PROJECT_ID>`: this lists nothing.

   ```sh
   gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
     --filter="bindings.members:serviceAccount:$SERVER_SA AND bindings.role~^roles/(cloudsql|editor|owner)" \
     --format='table(bindings.role)'
   ```

**If a check fails:**

- `Permission 'iam.serviceAccounts.getAccessToken' denied` or `unauthorized_client` at the sign-in step: the run
  was not on `master`, or the binding's `REPO_ID` or pool differ from the provider's; compare them with item 3.
- `does not have permission ... appengine.services.update` (or a `403` on `set-traffic`): item 2's role is
  missing.
- A run that refuses its target names why (unknown or stopped version, nothing older, split traffic) and moves
  nothing.
- A run that fails after choosing its target lists in its summary where traffic is now. If it is not where it
  should be, run Server release again with the version that was live, which the summary also names.

**Rollback:** clear the variable `GCP_WORKLOAD_IDENTITY_PROVIDER`; both workflows sign in with `GCP_KEY` again.
This works only until the key is deleted below.

**Then retire the key**, once checks 1, 3 and 4 passed:

1. Delete the repository secret `GCP_KEY` on GitHub.
2. Delete the key in GCP. List the account's user-managed keys:
   `gcloud iam service-accounts keys list --iam-account="$SERVER_SA" --managed-by=user`. The one stored as `GCP_KEY`
   has the id in its JSON's `private_key_id`; without the file, and with more than one key listed, ask whoever
   created them before deleting any. Delete it:
   `gcloud iam service-accounts keys delete <key id> --iam-account="$SERVER_SA"`.
3. Tell Alexander: the key path then leaves the workflows' code.

## Operating production

### Deploying production

- **A push to `master`** builds and deploys on Vercel. A build that must compile the wasm packages (the first one,
  and any after a change under `wasm/`) does not finish inside Vercel's build time limit; it stores them in Vercel's
  Remote Cache on the way, so the next build of the same `wasm/` finishes
  ([deploy-client-vercel.md, "Build cache"](deploy-client-vercel.md#build-cache)). Its log says
  `>>> Remote Cache: VERCEL_ARTIFACTS_TOKEN set`; if it says `unset`, tell Alexander. After any push, check Vercel →
  Deployments for which deployment is Current.
- **A full build from the checkout:** `make deploy-client-to-vercel-production`, as in step 7. Use it when a Git
  build times out, or after a change to a `REACT_APP_*` variable when no push is coming: those are inlined into the
  bundle at build time.
- **After a change in Doppler:** its sync redeploys production on Vercel, which rebuilds, so `REACT_APP_*` changes
  are picked up too. Check Deployments for the new deployment. If none appears, or it fails, use one of the ways
  here.
- **Server variables only:** after a change that touches no `REACT_APP_*` variable, deploy the last full local build
  again from the repository root, `npx vercel@62.7.0 deploy --prebuilt --prod --archive=tgz`. A function reads the
  variables the project held when its deployment was created. This works only while `.vercel/output` is the build
  of the commit production runs; after a push to `master` has deployed a newer commit, use a full build instead.

Rolling back (Deployments → the previous one → Instant Rollback, or `vercel promote <url> --prod`) restores that
deployment's code and variables. It does not undo a migration or a Firewall change. After an Instant Rollback,
Vercel stops giving the production domain to new production deployments until you promote one or undo the rollback.

### Releasing the build server

A tagged commit on `master` deploys a new `playground-server` version with no traffic (`cicd.yml`); the App Engine
version is the tag with dots as dashes (`1.2.3` → `1-2-3`). Nothing moves traffic but **Actions → Server
release → Run workflow**, on `master`:

- **Release:** `version` set to the new version (`1.2.3` or `1-2-3`). The run sends it all traffic, reads the
  traffic back, and fails unless the version holds all of it.
- **Roll back:** `version` empty. The run sends all traffic to the newest serving version created before the live
  one. App Engine does not record which versions were ever live, so a version parked and never released counts,
  and a second empty run goes further back instead of undoing the first. When a bad version sits in between, name
  the version you want instead.

Each run's summary names the version before and the target, written before traffic moves, so a run that fails
afterwards still says which version to go back to. Run one at a time: a newer dispatch replaces a waiting one. A
rollback returns the server's code, not its data. The client rolls back separately, in Vercel
([Deploying production](#deploying-production)).

### Migrations

A push to `master` deploys production, so a pull request that adds a file under `client-v2/db/migrations` merges
only after its migration is applied. Alexander tells you which pull request. From the repository root:

```sh
git fetch https://github.com/solana-foundation/solana-playground.git pull/<number>/head
git checkout --detach FETCH_HEAD
make migrate-production-db
make migrate-production-db   # again: prints `nothing to apply`
git checkout master
```

dbmate applies the migrations of the checkout it runs in, hence the checkout. Then tell Alexander; the pull request
merges after that. Migrations are written so the code already deployed keeps working on the new schema.

### The assistant's spend

- **Stop spend at once:** switch on `[EMERGENCY] Deny /api/agent` in the Firewall and publish
  ([firewall.md, "Emergency switches"](firewall.md#emergency-switches)).
- **Credits:** `<TOP_UP_OWNER>` reads the balance in the Nous dashboard. An empty balance refuses every turn until
  credits are added, and Sentry receives the `api:agent` error `upstream credit balance is empty`.
- **A leaked key:** create a new one in Nous with the same limits, replace it in `<DOPPLER_CONFIG>` (the sync
  redeploys), check the new deployment is Current, then revoke the old one.

### Adding an operator

[cloud-sql.md, "Adding an operator"](cloud-sql.md#adding-an-operator), the production part.
