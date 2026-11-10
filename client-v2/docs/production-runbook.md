# Production runbook: client-v2 on Cloud SQL

The steps that move `client-v2`'s production (the Vercel project and its `api/*.mjs` functions) onto Postgres on
Cloud SQL instance `solpg`, and release it on the custom domain, for the team that runs the Google Cloud project and
the Vercel production project. Production has no users yet, so nothing is copied: the cutover starts on an empty
database, and the release empties it once more.

This page gives the order, the gates between steps, the check after each step, and the rollback. The commands live in
[Cloud SQL for client-v2](cloud-sql.md) ("cloud-sql.md" below), [Deploy the client to Vercel](deploy-client-vercel.md)
("deploy-client-vercel.md") and [Firewall](firewall.md); each step links the section it runs.

**Stop at a failed check.** Do not start the next step. Send Alexander Anikeev (`alexander.anikeev@hoodies.team`, or
`<SUPPORT_CHANNEL>`) the command and its whole output, never a secret value. Alexander has no access to the Google
Cloud project or the Vercel project, so every step here is run by you; he reads output, answers questions and checks
the public URLs from outside.

## Values the client fills in

Nothing below is known to the authors of this page. Fill each in once, before step 1.

| Placeholder | What it is | Where to find it | Name in cloud-sql.md |
| --- | --- | --- | --- |
| `<PROJECT_ID>` | The Google Cloud project that holds instance `solpg` | Cloud console, project picker | `PROJECT_ID` |
| `<REGION>` | The region of `solpg` | `gcloud sql instances describe solpg --project=<PROJECT_ID> --format='value(region)'`. The [design](../../openspec/changes/cloud-sql/design.md) recorded `us-central1` on 2026-10-22; use what the command prints | `REGION` |
| `<TEAM_SLUG>` | The Vercel team that owns the production project | The path in the team's Vercel URL | `TEAM_SLUG` |
| `<VERCEL_PROJECT>` | The production Vercel project's name | Vercel → the project → Settings → General | `VERCEL_PROJECT` |
| `<VERCEL_PROJECT_ID>` | The same project's id, `prj_...` | Same page | |
| `<OPERATOR>` | The Google account of each person who runs migrations, lower case | Your team | `OPERATOR` |
| `<VERCEL_APP_DOMAIN>` | The project's stable `<name>.vercel.app` production domain, used until the release | Vercel → Settings → Domains. [deploy-client-vercel.md, "Sign-in on previews"](deploy-client-vercel.md#sign-in-on-previews) names `solana-playground-teal.vercel.app` as the production host; confirm it is this project's | |
| `<CUSTOM_DOMAIN>` | The launch domain, without `https://` | Your team | |
| `<GITHUB_OAUTH_APP>` | The GitHub OAuth app production signs in with, and the organization that owns it | GitHub → the organization → Settings → Developer settings → OAuth Apps | |
| `<BUILD_SERVER_CONTACT>` | Whoever sets `PG_CLIENT_URLS` on the build server (App Engine) | Your team | |
| `<NOUS_ACCOUNT>` | The Nous Research account that holds the prepaid credits the assistant spends | Your team | |
| `<TOP_UP_OWNER>` | The person who adds Nous credits when the balance runs low. Nous has no auto top-up: an empty balance stops the assistant for everyone | Your team | |
| `<SPEND_SIGN_OFF>` | Who signed off the assistant's monthly spend of $1,500 (the two keys' monthly limits), and when | Your team | |
| `<SUPPORT_CHANNEL>` | Where to reach Alexander during and between the live sessions | Agreed with Alexander | |
| `<SESSION_SETUP>`, `<SESSION_CUTOVER>`, `<SESSION_RELEASE>` | Date, time and time zone of the live sessions for steps 1 to 4, step 6, and step 7 | Agreed with Alexander; the launch is Wed 11 Nov 2026 | |

cloud-sql.md writes some of these in lower case inside SQL and commands: `<project id>` is `<PROJECT_ID>`,
`<operator e-mail>` is `<OPERATOR>`, `<custom domain>` is `<CUSTOM_DOMAIN>`. Its "Values used below" also asks for
`REPO`, which only the preview steps read; production needs none. Two values appear during the run, not before it:
`<deployment url>`, printed by the deploy in step 2, and `<bypass secret>`, created in step 2.

Secret values (keys, tokens, client secrets) never go on this page, in a ticket, or in a message. The
[environment table](#production-environment) says where each one comes from.

## Before you start

On the machine that runs the steps:

- `gcloud`, logged in as `<OPERATOR>` (`gcloud auth login`), with rights to administer IAM and Cloud SQL in
  `<PROJECT_ID>`.
- [`cloud-sql-proxy`](https://cloud.google.com/sql/docs/postgres/sql-proxy#install), `psql`, and `dbmate`
  ([client-v2/db/README.md](../db/README.md)).
- Node at the version in `client-v2/.nvmrc`, yarn 1, `jq`, `make`, `curl`, `git` and `openssl`. A production build
  installs Rust itself (`scripts/vercel-install.sh`) and takes about an hour on a cold machine.
- A full clone (not `--depth`) of `solana-foundation/solana-playground`, on `master`. Every command runs from that
  checkout. If `client-v2/Makefile.vercel` is missing there, stop and ask Alexander: steps 2, 4, 6 and 7 use its
  targets.
- The checkout linked to the production project, once, from the repository root, with a Vercel token that can read
  the project ([deploy-client-vercel.md, "One-time setup"](deploy-client-vercel.md#one-time-setup) step 5, and
  [Tokens](deploy-client-vercel.md#tokens)):

  ```sh
  VERCEL_TOKEN=<token> VERCEL_PROJECT_ID=<VERCEL_PROJECT_ID> make -f client-v2/Makefile.vercel vercel-bootstrap
  npx vercel@62.7.0 login
  make -f client-v2/Makefile.vercel vercel-auth
  ```

  `vercel-auth` prints `Vercel CLI user: <you>`. The CLI version is the one pinned as `VERCEL_CLI` in
  `client-v2/Makefile.vercel`; use that version wherever this page says `npx vercel@62.7.0`.

Access the steps need, besides the machine:

- Google Cloud: IAM and Cloud SQL administration in `<PROJECT_ID>`, and Secret Manager (step 5).
- Vercel: the production project's environment variables, Deployment Protection, Domains and Firewall; the team
  setting for the OIDC issuer mode (step 1).
- Nous Research: `<NOUS_ACCOUNT>`'s dashboard, to create the assistant's keys and their spend limits and to read
  their spend (step 4).
- The production Neon database, through the Neon console or the Vercel project's Storage tab: step 4 migrates it,
  step 6 counts its accounts, and step 6's rollback restores its connection strings.
- GitHub: admin on `solana-foundation/solana-playground` for an Actions secret (step 2), and on the organization
  that owns `<GITHUB_OAUTH_APP>` (steps 4 and 7).
- Sentry: a token that may upload source maps (step 4).
- DNS of `<CUSTOM_DOMAIN>` (step 7).

Two Vercel settings to check once:

- The team setting **Enforce Sensitive Environment Variables** (team Settings → Security) is off, or at least does not
  cover this project's Production. With it on, `SENTRY_AUTH_TOKEN` and the database variables become Sensitive, a
  local build pulls them as empty, and the production build and `migrate-production-db` fail.
- The project's Settings → Environment Variables has **Automatically expose System Environment Variables** on. The
  application decides by `VERCEL_ENV` which database it may open, and the build by `VERCEL_ENV` whether to upload
  source maps.

Then record what Production holds today and what it answers, and keep both outputs:

```sh
npx vercel@62.7.0 env ls production
curl -s https://<VERCEL_APP_DOMAIN>/api/sync
```

**Each new shell** (every live session) starts by setting cloud-sql.md's
["Values used below"](cloud-sql.md#values-used-below) again: steps 6 and 7 use `$PROJECT_ID`, `$REGION`,
`$OPERATOR`, `$PRODUCTION_DB_USER`, `$PRODUCTION_SA` and `$PROJECT_NUMBER`.

To open `psql` on `solpg` as the operator, which several checks do, from any directory:

```sh
cloud-sql-proxy --auto-iam-authn --gcloud-auth --port 5434 "$PROJECT_ID:$REGION:solpg" &
psql "postgres://$(printf %s "$OPERATOR" | sed 's/@/%40/')@127.0.0.1:5434/solpg?sslmode=disable"
# afterwards: kill %1
```

## Order and gates

Run the steps in this order. Each gate names what must be true before the step after it starts.

1. **Google Cloud setup (step 1) before the staged deployment (step 2).** Step 2 is the first time a Vercel
   deployment exchanges its token for the production service account; without step 1 it has nothing to reach.
2. **The Firewall (step 3) before the hosted AI key goes into Production (step 4).** The key spends money on every
   turn, and the rate limit is what stops one client from spending a key's daily limit in a minute.
3. **Before the hosted key is set in step 4, all of these hold:**
   - Production sets only `PG_AI_*` names, and no `AGENT_*` name at all (`vercel env ls production` lists none).
   - `AUTH_BASE_URL` is the domain users open: `https://<VERCEL_APP_DOMAIN>` until the release,
     `https://<CUSTOM_DOMAIN>` after it.
   - The Firewall has live rules on `/api/agent` and on `/api/ai/status`.
   - The database production reads has every migration: `migrate-production-db` reports nothing to apply
     ([Migrate first, then merge](#migrate-first-then-merge)).
   - Alexander has confirmed that the assistant's code on `master` is the launch code.
4. **Migrate first, then merge to `master`.** A push to `master` can deploy production, so a pull request that adds a
   migration merges only after you have applied that migration to production. One is pending now: foundation PR #114
   adds `20261105120000_agent_turn_at_reserve.sql`, and must not merge before you run
   [Migrate first, then merge](#migrate-first-then-merge) for it.
5. **The cutover (step 6) happens on `<VERCEL_APP_DOMAIN>`.** The custom domain is not attached before step 7.
6. **The release (step 7) empties `solpg`**, then sets `AUTH_BASE_URL` and the GitHub OAuth callback to the custom
   domain and attaches the domain.

Step 5 (Secret Manager) runs alongside step 4: a secret goes into Secret Manager when its value is in hand, since a
Sensitive value cannot be read back from Vercel afterwards.

## Deploying production

Two ways put a new deployment on the production domain:

- **A full build, from the checkout:** `make -f client-v2/Makefile.vercel deploy-client-to-vercel-production`. It
  pulls Production's variables, prints the commit, asks for a typed `yes`, builds locally and deploys. Use it after
  any change to a `REACT_APP_*` variable, since those are inlined into the browser bundle at build time.
- **Server variables only:** after a change that touches no `REACT_APP_*` variable, deploy the last full build again
  from the repository root, `npx vercel@62.7.0 deploy --prebuilt --prod --archive=tgz`. A function reads the
  variables the project held when its deployment was created
  ([deploy-client-vercel.md, "Deploy"](deploy-client-vercel.md#deploy)). This works only while `.vercel/output` is
  the build of the commit production runs.

A push to `master` also starts a production build on Vercel through the Git integration. Every such build on
`master` from 2026-10-19 to 2026-11-03 failed, so a full local build is the dependable path; after any push, check
Vercel → Deployments for which deployment is Current.

Rolling back a deployment (Deployments → the previous one → Instant Rollback, or `vercel promote <url> --prod`)
restores that deployment's code and the variables it was created with. It does not undo a migration or a Firewall
change. After an Instant Rollback, Vercel stops giving the production domain to new production deployments: the next
deploy goes live only once you promote it (`vercel promote <url> --prod`) or undo the rollback in the dashboard.

## Production environment

Every variable the production build and the functions read, from `src/shared/config/server-env.mjs`,
`src/shared/config/client-env.ts`, `scripts/check-agent-env.mjs` and the build scripts. "Sensitive" means a Vercel
Sensitive variable (`vercel env add --sensitive`): its value cannot be read back, and a local build pulls it as empty.

**`REACT_APP_*` values are inlined into the browser bundle and readable by every visitor. Nothing secret goes in
one.**

### Database (Cloud SQL)

| Variable | Required | Value | Sensitive | Set in |
| --- | --- | --- | --- | --- |
| `DB_PROVIDER` | Yes, from step 6 | `cloud-sql`. Unset means `url` (Neon) | No | Step 2 (`-e` only), step 6 |
| `CLOUD_SQL_INSTANCE` | With `cloud-sql` | `<PROJECT_ID>:<REGION>:solpg` | No | Step 2 (`-e`), step 6 |
| `CLOUD_SQL_DATABASE` | With `cloud-sql` | `solpg`. In production the application refuses any other name | No | Step 2 (`-e`), step 6 |
| `CLOUD_SQL_USER` | With `cloud-sql` | `vercel-production@<PROJECT_ID>.iam` | No | Step 2 (`-e`), step 6 |
| `GCP_PROJECT_NUMBER` | With `cloud-sql` | `gcloud projects describe <PROJECT_ID> --format='value(projectNumber)'` | No | Step 2 (`-e`), step 6 |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | With `cloud-sql` | `vercel` | No | Step 2 (`-e`), step 6 |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | With `cloud-sql` | `vercel` | No | Step 2 (`-e`), step 6 |
| `GCP_SERVICE_ACCOUNT_EMAIL` | With `cloud-sql` | `vercel-production@<PROJECT_ID>.iam.gserviceaccount.com` | No | Step 2 (`-e`), step 6 |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Until step 6 | The production Neon database, pooled and direct | As today | Removed in step 6; restored by its rollback |

### Sync and sign-in

| Variable | Required | Value | Sensitive | Set in |
| --- | --- | --- | --- | --- |
| `SYNC_ENABLED` | Yes | Exactly `true`. Anything else turns sync off | No | Step 6 makes sure (`false` on the step 2 deployment only) |
| `AUTH_SECRET` | Yes | Generated for production, `openssl rand -base64 32`, used nowhere else. Rotating it signs everyone out | Yes | Step 4 (check it exists) |
| `AUTH_BASE_URL` | Yes; a production build fails without it | `https://<VERCEL_APP_DOMAIN>`, then `https://<CUSTOM_DOMAIN>`. No trailing slash | No | Step 2 if missing, step 4 checks, step 7 |
| `GITHUB_CLIENT_ID` | Yes | `<GITHUB_OAUTH_APP>`'s Client ID. Its callback URL is `<AUTH_BASE_URL>/api/auth/callback/github` | No | Step 4 (check), step 7 (callback) |
| `GITHUB_CLIENT_SECRET` | Yes | `<GITHUB_OAUTH_APP>`'s client secret | Yes | Step 4 (check) |
| `AUTH_OAUTH_PROXY_SECRET` | Only if previews sign in through production | The same value as on Preview, never equal to any `AUTH_SECRET` ([Sign-in on previews](deploy-client-vercel.md#sign-in-on-previews)) | Yes | Leave as it is |
| `AUTH_OAUTH_PROXY_URL` | Never on Production | Preview only | | |

### Assistant default backend

The assistant runs on Nous Research, from `<NOUS_ACCOUNT>`'s prepaid credits. Its two keys are created first, in
step 4 ([deploy-client-vercel.md, "Default backend spend"](deploy-client-vercel.md#default-backend-spend), "Nous
setup"). Vercel AI Gateway is a documented fallback for when the credits are used up; do not set it up for the launch.

| Variable | Required | Value | Sensitive | Set in |
| --- | --- | --- | --- | --- |
| `PG_AI_API_KEY` | Yes; every Vercel build fails without it | The Nous `established` key | Yes | Step 4 |
| `PG_AI_NEWCOMER_API_KEY` | No, recommended | The Nous `newcomer` key. Unset, newcomers spend through `PG_AI_API_KEY`, and new accounts share the established users' limit | Yes | Step 4 |
| `PG_AI_BASE_URL`, `PG_AI_MODEL` | No | Leave unset: they default to Nous (`https://inference-api.nousresearch.com/v1`, `z-ai/glm-5.3-flash:US`). Set only to move to the Gateway | No | |
| `PG_AI_REASONING_EFFORT`, `PG_AI_PROVIDERS`, `PG_AI_PRICE_INPUT`, `PG_AI_PRICE_OUTPUT`, `PG_AI_MAX_BODY_BYTES`, `PG_AI_MAX_OUTPUT_TOKENS`, `PG_AI_NEWCOMER_AGE_DAYS`, `PG_AI_NEWCOMER_DAILY_CAP`, `PG_AI_ESTABLISHED_DAILY_CAP` | No | Leave unset: each defaults as `agentEnv` in `src/shared/config/server-env.mjs` sets it, listed in [Default backend spend](deploy-client-vercel.md#default-backend-spend) | No | |
| Any `AGENT_*` | Never | The deprecated names. Delete every one | | Step 4 |
| `SOURCES`, `MCP_EXPLORER_URL`, `MCP_EXPLORER_TOKEN`, `MCP_EXPLORER_BYPASS` | No | Leave unset unless told otherwise ([Sources catalogue](deploy-client-vercel.md#sources-catalogue)) | Token and bypass: yes | |

### Observability

| Variable | Required | Value | Sensitive | Set in |
| --- | --- | --- | --- | --- |
| `REACT_APP_SENTRY_DSN` | Yes, for error reports | The DSN of Sentry project `solana-playground` in organization `solana-fndn` (both fixed in `scripts/upload-sourcemaps.mjs`). Public: the browser and the functions share it | No | Step 4 |
| `SENTRY_AUTH_TOKEN` | Yes; a production build fails without it | A Sentry auth token that may upload source maps to that project. Read by the build only | **No**: a local build pulls a Sensitive value as empty and then fails | Step 2 if missing or Sensitive |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0` to `1`. Unset traces every API request | No | |
| `SENTRY_PREVIEW_ENABLED`, `SOURCEMAPS_PREVIEW_ENABLED` | Never on Production | Preview only | | |
| `REACT_APP_GA_MEASUREMENT_ID` | No | `G-...`, if the Foundation uses Google Analytics | No | Step 4 |
| `REACT_APP_LOG_LEVEL` | No | Unset logs `warn` in production | No | |

### Browser and build

| Variable | Required | Value | Sensitive | Set in |
| --- | --- | --- | --- | --- |
| `REACT_APP_DEVNET_RPC_URL`, `REACT_APP_TESTNET_RPC_URL`, `REACT_APP_MAINNET_RPC_URL` | No | Triton's URLs, **only if Triton has restricted the keys in them to `<VERCEL_APP_DOMAIN>` and `<CUSTOM_DOMAIN>`**: every visitor can read them. Without that restriction leave them unset; the public endpoints stay | No (public by design) | Step 4 |
| `REACT_APP_SERVER_URL` | No | Unset uses the Foundation's build server | No | |
| `REACT_APP_SERVER_UNSTABLE` | Never `true` | A Vercel build with `true` fails | No | |
| `REACT_APP_VERCEL_ENV`, `REACT_APP_VERCEL_GIT_COMMIT_SHA` | Never | `scripts/vercel-build.sh` sets both | | |
| `USE_WASM_STUBS` | Never | A deployment with `true` fails its install (`scripts/vercel-install.sh`) | | |
| `VERCEL_ENV` and Vercel's other system variables | Never as a project variable | Vercel sets them; see the system variables setting in [Before you start](#before-you-start) | | |
| `VERCEL_ARTIFACTS_TOKEN`, `VERCEL_ARTIFACTS_OWNER` | No | Remote Cache for Git-integration builds ([Build cache](deploy-client-vercel.md#build-cache)) | Token: yes | |

### Outside Vercel

| Where | Name | Value | Set in |
| --- | --- | --- | --- |
| GitHub, `solana-foundation/solana-playground` → Settings → Secrets and variables → Actions → Repository secrets | `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel → the project → Settings → Deployment Protection → Protection Bypass for Automation. Read by a CI job that checks production after each push to `master`, once foundation PR #102 merges; set it in advance | Step 2 |
| The build server's environment | `PG_CLIENT_URLS` | Must include `https://<VERCEL_APP_DOMAIN>` and, from step 7, `https://<CUSTOM_DOMAIN>`, or the browser's build requests are refused by CORS | Before step 4; step 7 |

## Step 1: Google Cloud and Cloud SQL

Ticket HOO-1735. Live session `<SESSION_SETUP>`.

**What for:** the identity production connects as, and the instance settings that let only that identity in.
Vercel's OIDC token is exchanged through Workload Identity Federation for the service account `vercel-production`,
which logs in to Postgres with IAM; there is no password or key anywhere.

**Preconditions:** the tools in [Before you start](#before-you-start); every placeholder filled in; a time when a
restart of `solpg` does no harm (changing its flags may restart it).

**Run:** [cloud-sql.md](cloud-sql.md), "Values used below", then steps 1 to 5, in one shell (step 4 defines helpers
that step 5 uses). Step 3 is the Vercel dashboard: OIDC Federation on with issuer mode **Team**, and the Function
Region nearest `<REGION>`.

**Check**, with the commands in [cloud-sql.md, "Checks"](cloud-sql.md#checks):

1. `gcloud sql instances describe solpg ...` shows `cloudsql.iam_authentication` `on`, `connectorEnforcement:
   REQUIRED`, `sslMode: ENCRYPTED_ONLY`.
2. `\l solpg` through the proxy shows `CONNECT` for `vercel-production@<PROJECT_ID>.iam` and none for `PUBLIC`;
   `\drg` (psql 16 and later; `\du` before) shows no member of that role other than the operators.
3. `psql` straight to the instance's public IP on port 5432 never reaches a password prompt.
4. `dbmate status` against `solpg`, as the operator, lists every file in `client-v2/db/migrations` as pending. From
   the repository root:

   ```sh
   (cd client-v2 && CLOUD_SQL_INSTANCE="$PROJECT_ID:$REGION:solpg" CLOUD_SQL_USER="$PRODUCTION_DB_USER" \
     CLOUD_SQL_DATABASE=solpg scripts/db/cloud-sql/migration-url production -- dbmate status)
   ```

   Expected: one `[ ]` line per migration file, `Applied: 0`.

**If a check fails:** nothing reads `solpg` yet, so fix and run the step again. A `GRANT` that answers
`permission denied` has its own fix in step 5 of cloud-sql.md. A proxy that does not start prints its log: usually
`gcloud` is logged in as someone without the Cloud SQL roles step 5 grants. Neon is not touched by this step.

**Ping Alexander:** when a step marked _unverified_ in cloud-sql.md behaves differently from what it says, and with
the outputs of checks 1 and 2 once they pass.

## Step 2: staged production deployment, sync off

Ticket HOO-2415.

**What for:** the first real token exchange. A production deployment that takes no domain proves that the production
environment's own identity reaches `solpg`, while the production domain keeps serving the current deployment on
Neon.

**Preconditions:**

- Step 1's checks pass.
- Production holds what a production build requires, or `vercel build --prod` fails before anything is deployed:
  `PG_AI_API_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_BASE_URL`, `DATABASE_URL`, and
  `SENTRY_AUTH_TOKEN` not Sensitive. Compare with the `vercel env ls production` output you kept.
  - Missing `AUTH_BASE_URL` or `SENTRY_AUTH_TOKEN`, or a Sensitive `SENTRY_AUTH_TOKEN`: set them now, with the values
    and the method of step 4. Gate 2 holds back only the AI key.
  - The key under a deprecated `AGENT_*` name: the build accepts it for this step; step 4 replaces it.
  - No key under either name: stop and ask Alexander. Setting one is step 4, which waits for the Firewall.
- A Protection Bypass for Automation exists: Vercel → Settings → Deployment Protection → Protection Bypass for
  Automation. Store its value as the GitHub repository secret `VERCEL_AUTOMATION_BYPASS_SECRET`
  ([Outside Vercel](#outside-vercel)).

**Run:** [cloud-sql.md, step 6](cloud-sql.md#6-vercel-the-production-environment-staged). Keep the deployment URL
`deploy` prints.

**Check:**

1. `curl -s -H "x-vercel-protection-bypass: <bypass secret>" https://<deployment url>/api/sync` answers
   `{"enabled":false,"db":"ok"}`.
2. The instance's log shows `vercel-production@<PROJECT_ID>.iam` logging in: Cloud console → Logging → Logs Explorer,
   resource Cloud SQL Database, database `<PROJECT_ID>:solpg`, search `vercel-production`. If the instance logs no
   connections, run `select usename, datname from pg_stat_activity where datname = 'solpg';` through the proxy within
   10 seconds of check 1, while the function's pool still holds its connection. That the log names the user is
   unverified.
3. `curl -s https://<VERCEL_APP_DOMAIN>/api/sync` answers as it did before the step: the production domain is
   unchanged.

Record and send to Alexander:

- The latency, cold and warm: run
  `curl -s -o /dev/null -w '%{time_total}\n' -H "x-vercel-protection-bypass: <bypass secret>" https://<deployment url>/api/sync`
  once 15 minutes after the last request, then twice more straight away.
- `show max_connections;` on `solpg` through the proxy. Each function instance opens at most `POOL_LIMITS.max`
  connections (`src/features/persistence/model/providers/url.mjs`); the peak count of concurrent function instances,
  if the Vercel dashboard shows one.
- Whether Vercel refuses a project variable named `VERCEL_ENV`: try to add one on **Preview** only, with the value
  `shadow-test` (never `production`), in Settings → Environment Variables, and delete it at once if accepted. The application's production check reads `VERCEL_ENV`
  ([cloud-sql.md, "Four gates"](cloud-sql.md#four-gates-between-a-preview-and-solpg)).

**If a check fails:** check 1's body says which side:

- `"db":"unconfigured"`: an `-e` value is missing or misspelt.
- `"db":"unreachable"`: the token exchange or the login failed. The deployment's function log (Deployments → the
  deployment → Logs, filter `/api/sync`) names the cause. A line starting `db: refusing` names the instance or
  database the application refused. Otherwise compare, in order: OIDC issuer mode Team; the subject in step 4's
  binding (`owner:<TEAM_SLUG>:project:<VERCEL_PROJECT>:environment:production`); the two roles on `solpg`; the IAM
  database user.
- `401` or a Vercel login page: the bypass header is missing or wrong.

**Rollback:** none needed. The deployment has no domain and no project variable changed; delete it from Deployments
if you like.

**Ping Alexander:** with the body of check 1 and the recorded values, pass or fail.

## Step 3: Firewall

Ticket HOO-2412.

**What for:** a rate limit per client on the routes that spend money or open a database connection, and an emergency
switch that turns the hosted assistant off without a redeploy.

**Preconditions:** none beyond access to the project's Firewall tab. The rules cover every domain of the project, so
they hold after the release without change.

**Run:** [firewall.md](firewall.md): "Before configuring", then every rule under "Rules to configure", including
`Rate limit /api/ai/status (IP)` and the two `[EMERGENCY]` rules, which are created **disabled**. Publish.

**Check**, from one machine, with [firewall.md, "Verifying"](firewall.md#verifying):

1. The 40-request loop against `https://<VERCEL_APP_DOMAIN>/api/agent` answers `200` for the first 30 and `429` with
   an `x-vercel-mitigated` header after that.
2. The same loop with `seq 1 70` against `https://<VERCEL_APP_DOMAIN>/api/ai/status` answers `429` after 60.
3. The same loop with `seq 1 30` against `https://<VERCEL_APP_DOMAIN>/api/auth/sign-in/social` answers `429` after
   20. This is the check "Before configuring" asks for: it shows whether the firewall matches the path before
   `vercel.json` rewrites it. Report the result either way.
4. The Firewall overview lists each under its rule name, and the rule list shows `[EMERGENCY] Deny /api/agent`
   and `[EMERGENCY] Rate limit /api/agent (JA4)` as Disabled.

Your own IP is limited for up to 60 seconds afterwards.

**If a check fails:** no `429` means the rule is not published, its path expression does not match, or a `Bypass`
rule sits above it ("Order" in firewall.md). If the app stops loading or signing in, a managed bot rule is
challenging the page's own requests: switch that rule off.

**Rollback:** disable the rule and publish. The Firewall's Audit Log lists every change.

**Ping Alexander:** with the outputs of checks 1 to 3.

## Step 4: Production environment

Tickets HOO-1745 (the hosted key), HOO-1796 (the RPC URLs), HOO-1801 (Sentry on the functions).

**What for:** every variable in [Production environment](#production-environment) with its launch value, on the
deployment that still reads Neon.

**Preconditions:** every item of gate 3 in [Order and gates](#order-and-gates). For the migration item, run
`make -f client-v2/Makefile.vercel migrate-production-db` from the repository root: while Production's `DB_PROVIDER`
is unset it migrates the production Neon database, prints its host, and either reports `nothing to apply` or lists
what is pending and asks for `yes`. Also: `<SPEND_SIGN_OFF>` and `<TOP_UP_OWNER>` are filled in,
`PG_CLIENT_URLS` on the build server includes `https://<VERCEL_APP_DOMAIN>` (ask `<BUILD_SERVER_CONTACT>`), and
Triton has answered whether its keys are restricted to your domains.

**Run:**

1. In `<NOUS_ACCOUNT>`'s dashboard, create two keys, each with a daily and a monthly spend limit:

   | Key | Daily limit | Monthly limit | Goes into |
   | --- | --- | --- | --- |
   | `established` | $50 | $1,250 | `PG_AI_API_KEY` |
   | `newcomer` | $10 | $250 | `PG_AI_NEWCOMER_API_KEY` |

   A key is shown once, at creation: put it in Secret Manager at once ([step 5](#step-5-secrets-into-secret-manager)).
   The limits are the ceiling on what the assistant can spend, whatever the application does. The daily limit is a
   rolling window that starts with the key's first request. Note the prepaid balance, and tell `<TOP_UP_OWNER>` how
   to read it: Nous has no auto top-up, and an empty balance refuses every turn until credits are added.
2. Delete every `AGENT_*` variable: `npx vercel@62.7.0 env rm <NAME> production --yes`.
3. Set each variable of the tables marked "Step 4", in Vercel → Settings → Environment Variables, Production only,
   or from the shell:

   ```sh
   printf %s '<value>' | npx vercel@62.7.0 env add <NAME> production --sensitive --force
   ```

   with `--no-sensitive` instead of `--sensitive` for the variables the tables mark "No". Store each secret in
   Secret Manager as you set it ([step 5](#step-5-secrets-into-secret-manager)).
4. Check that `<GITHUB_OAUTH_APP>`'s callback URL is `https://<VERCEL_APP_DOMAIN>/api/auth/callback/github`.
5. Deploy with a full build ([Deploying production](#deploying-production)): the `REACT_APP_*` values changed.

**Check:**

1. The build log has none of these lines: `check-agent-env: deprecated AGENT_* names still set`,
   `warning: SENTRY_AUTH_TOKEN is not set`, `warning: source maps: upload failed`. A line
   `check-agent-env: ... empty here` is expected on a local build: it names the Sensitive variables the pull held as
   empty.
2. `curl -s https://<VERCEL_APP_DOMAIN>/api/ai/status`, signed out, answers
   `{"available":false,"key":"hosted","reason":"signed-out","model":"z-ai/glm-5.3-flash:US"}`.
3. Signed in on `https://<VERCEL_APP_DOMAIN>` in a browser, the assistant answers a question on the default backend,
   and the Nous dashboard shows spend on the `newcomer` or `established` key.
4. **The newcomer cap.** Sign in with a GitHub account created less than 30 days ago (create one if your team has
   none), and send turns on the default backend until the chat says "You have used today's free assistant
   allowance. It resets at 00:00 UTC, or bring your own key to keep going." That takes about 13 turns, $0.10 in
   all. Then compare what the application charged that account with what Nous counted on the `newcomer` key. In
   the Neon SQL editor of the database production reads:

   ```sql
   select sum(charged) / 1e6 as usd, count(*) as turns
   from agent_turn
   where user_id = (select "userId" from account
                    where "providerId" = 'github' and "accountId" = '<numeric GitHub id of the account>')
     and day = (now() at time zone 'utc')::date;
   ```

   The numeric id is in `https://api.github.com/users/<login>`. `usd` should match the `newcomer` key's spend in
   the Nous dashboard for the same turns, to within a cent: the application charges the cost Nous reports for each
   turn. Spend on the `newcomer` key from anyone else in the same window adds to the dashboard's figure, so run
   this check before the domain is shared.
5. With RPC URLs set: the endpoint picker lists the "(Platform)" entries, and one of them answers.
6. `curl -s https://<VERCEL_APP_DOMAIN>/api/sync` answers `{"enabled":true,"db":"ok"}`, or
   `{"enabled":false,"db":"ok"}` while `SYNC_ENABLED` is not `true`. The database is still Neon.

**If a check fails:** a failed build prints `check-agent-env: <what is missing>`, naming the variable. A turn answered
`502` is logged as `agent: upstream refused the default backend` with a cause: the key and `PG_AI_BASE_URL` do not
belong to the same upstream ([Assistant default backend](deploy-client-vercel.md#assistant-default-backend)).

**Rollback:** to stop spend at once, switch on `[EMERGENCY] Deny /api/agent` and publish. To undo the whole step,
roll back to the previous deployment ([Deploying production](#deploying-production)); it keeps the variables it was
created with. Before the next deploy, set the previous values again from Secret Manager, or from the source each row
of the table names, and promote that deploy.

**Ping Alexander:** when every check passes, with the list of names `vercel env ls production` prints (names only),
the `usd` and `turns` of check 4 beside the `newcomer` key's spend in the Nous dashboard, and `<SPEND_SIGN_OFF>`
and `<TOP_UP_OWNER>`.

## Step 5: secrets into Secret Manager

Ticket HOO-1795.

**What for:** a copy of each production secret under the Foundation's control. Sensitive Vercel variables cannot be
read back, so without a copy a lost value means a rotation. The application reads its secrets only from Vercel's
variables; nothing syncs the two, so every rotation updates both.

**When:** at the moment each value is in hand: when it is generated or shown (a Nous key is shown once, at
creation), in steps 2 and 4. A value already stored Sensitive in Vercel that nobody holds a copy of cannot be read
back; rotate it (a new value in both places) instead.

**Run**, once: `gcloud services enable secretmanager.googleapis.com --project=<PROJECT_ID>`. Then for each of
`AUTH_SECRET`, `GITHUB_CLIENT_SECRET`, `AUTH_OAUTH_PROXY_SECRET` (if set), `PG_AI_API_KEY`, `PG_AI_NEWCOMER_API_KEY`,
`SENTRY_AUTH_TOKEN`, the Protection Bypass for Automation secret, and any RPC URL that carries a key, under a name
your team chooses:

```sh
printf %s '<value>' | gcloud secrets create <secret name> --project=<PROJECT_ID> \
  --replication-policy=automatic --data-file=-
```

A later value of the same secret is `gcloud secrets versions add <secret name> --data-file=-`. Grant
`roles/secretmanager.secretAccessor` only to the people who rotate them. Rotating `AUTH_SECRET` signs everyone out.

**Check:** `gcloud secrets list --project=<PROJECT_ID>` lists each one, and
`gcloud secrets versions access latest --secret=<secret name> --project=<PROJECT_ID> | wc -c` prints a non-zero
length.

**Ping Alexander:** with the instance connection name production uses, `<PROJECT_ID>:<REGION>:solpg`, so HOO-1735
can be closed.

## Migrate first, then merge

Whenever a pull request adds a file under `client-v2/db/migrations`, and before it merges to `master`. Alexander
tells you which pull request; foundation PR #114 is the one pending now.

1. From the repository root, check out the pull request's head: dbmate applies the migrations of the checkout it runs
   in.

   ```sh
   git fetch https://github.com/solana-foundation/solana-playground.git pull/114/head
   git checkout --detach FETCH_HEAD
   make -f client-v2/Makefile.vercel migrate-production-db
   ```

   It prints the database it will migrate (the Neon host before step 6, `solpg` on Cloud SQL after), the pending
   list, and asks for `yes`. On Cloud SQL it needs `cloud-sql-proxy`, `psql`, and `gcloud` logged in as an
   operator.
2. **Check:** run the target again; it prints `nothing to apply`.
3. `git checkout master`, and tell Alexander. The pull request merges after that.

The migration of #114 keeps the code already deployed working: its new `settled_at` column has a default until a later
migration drops it. If the target fails midway, send Alexander the output; dbmate records each migration it finished
in `schema_migrations`.

The Neon path reads `DATABASE_URL_UNPOOLED` from the Production pull. If that variable is Sensitive, the pull holds
it empty and the target stops with `no DATABASE_URL_UNPOOLED in the Production environment`. Then run what the
target runs, with the direct (unpooled) connection string of the production Neon database from the Neon console:

```sh
cd client-v2
DATABASE_URL='<direct connection string>' dbmate status
DATABASE_URL='<direct connection string>' dbmate --no-dump-schema up
cd ..
```

Check first that the host in that string is the production Neon database, not a preview one.

## Step 6: cutover on the `vercel.app` domain

Ticket for `cloud-sql` task 3.2. Live session `<SESSION_CUTOVER>`, with Alexander.

**What for:** production reads and writes `solpg` from here on. Neon stays as it is and is the rollback.

**Preconditions:**

- Steps 1 to 4 pass.
- Alexander confirms that `master` holds the launch code, and that every account in the production Neon database is
  a test account. To count them:

  ```sh
  make -f client-v2/Makefile.vercel vercel-link-production
  psql "$(sed -n 's/^DATABASE_URL_UNPOOLED=//p' .vercel/.env.production.local | tr -d '"')" -c 'select count(*) from "user";'
  ```

  If the pulled value is empty (a Sensitive variable), run the `select` in the Neon console's SQL editor instead.

- No custom domain is attached to the project.

**Run:** in a new shell, set "Values used below" ([Before you start](#before-you-start)). Then
[cloud-sql.md, step 7](cloud-sql.md#7-cutover), items 1 to 6, from a checkout of `master`. For item 5 deploy as in
[Deploying production](#deploying-production); only server variables changed.

**Check:**

1. `\dt` on `solpg` (item 3) shows every table owned by `vercel-production@<PROJECT_ID>.iam`.
2. `curl -s https://<VERCEL_APP_DOMAIN>/api/sync` answers `{"enabled":true,"db":"ok"}`.
3. Sign in on `https://<VERCEL_APP_DOMAIN>`, create or edit a project, then through the proxy on `solpg`:
   `select count(*) from "user";` and `select count(*) from project_files;` both answer more than `0`.
4. `make -f client-v2/Makefile.vercel migrate-production-db` names `solpg` and prints `nothing to apply`.

Alexander then runs the pre-release checks on `<VERCEL_APP_DOMAIN>`: sign-in, sync across two browsers, the
assistant on the default key, the daily cap's `429`, a Sentry test event from the browser and from a function, and
the Firewall rule.

**If a check fails:** a body of `"db":"unconfigured"` or `"db":"unreachable"` has the same causes as in step 2; the
deployment's function log names them.

**Rollback:** [cloud-sql.md, step 7, "Rollback"](cloud-sql.md#7-cutover): restore `DATABASE_URL`,
`DATABASE_URL_UNPOOLED` and `DB_PROVIDER=url` on Production and redeploy. The Neon database was not written to after
the switch.

**Ping Alexander:** he is in the session; send him the outputs of checks 2 and 4.

## Step 7: release on the custom domain

Ticket HOO-2537. Live session `<SESSION_RELEASE>`, with Alexander.

**What for:** the launch domain starts on an empty database. The test accounts, sessions and projects from step 6 go
with the old one.

**Preconditions:**

- Step 6 passes, and Alexander has accepted the results of his pre-release checks.
- `<CUSTOM_DOMAIN>`'s DNS records are ready to point at Vercel (Vercel shows the records when the domain is added
  under Settings → Domains).
- `PG_CLIENT_URLS` on the build server includes `https://<CUSTOM_DOMAIN>` (ask `<BUILD_SERVER_CONTACT>`).
- A checkout of `master` that holds every migration production has. If a pull request's migration was applied ahead
  of its merge and the pull request is still open, run item 3 of the cloud-sql.md section below a second time, from
  that pull request's head, as in [Migrate first, then merge](#migrate-first-then-merge).

**Run:** in a new shell, set "Values used below" ([Before you start](#before-you-start)). Then
[cloud-sql.md, "Release: an empty `solpg` on the custom domain"](cloud-sql.md#release-an-empty-solpg-on-the-custom-domain),
items 1 to 6. For the redeploy in item 5, use either way in [Deploying production](#deploying-production). If the
Preview environment sets `AUTH_OAUTH_PROXY_URL`, set it to `https://<CUSTOM_DOMAIN>` as well, since previews sign
in through the production domain's callback.

**Check:**

1. `select count(*) from "user";` on `solpg` answers `0` after the migration and again after the redeploy, before
   anyone signs in.
2. `curl -s https://<CUSTOM_DOMAIN>/api/sync` answers `{"enabled":true,"db":"ok"}`.
3. `curl -s https://<CUSTOM_DOMAIN>/api/ai/status` answers as in step 4's check 2.
4. Sign in on `https://<CUSTOM_DOMAIN>` and edit a project; the `"user"` and `project_files` counts rise above `0`.

A sign-in on `<VERCEL_APP_DOMAIN>` is now refused at GitHub, and its writes answer `403`: production accepts one
origin, `AUTH_BASE_URL`.

Alexander then runs the launch checks on `<CUSTOM_DOMAIN>`: sign-in, a project syncs, the assistant answers, the cap
answers `429`, Sentry receives a test event, and production answers `{"enabled":true,"db":"ok"}` on
`GET /api/sync` after a push to `master` (a CI job, foundation PR #102, checks this once it merges; until then
Alexander checks it by hand).

**If a check fails:** sign-in failing at GitHub with "The redirect_uri is not associated with this application"
means the callback URL and `AUTH_BASE_URL` disagree. Writes answering `403` mean `AUTH_BASE_URL` is not exactly
`https://<CUSTOM_DOMAIN>`, or the redeploy did not happen after it was set.

**Rollback:** the release's rollback in cloud-sql.md returns to the `vercel.app` domain on an empty `solpg`. If
`solpg` itself is the problem, step 6's rollback to Neon still applies.

**Ping Alexander:** he is in the session; send him the outputs of checks 1 and 2.
