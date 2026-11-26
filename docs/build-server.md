# Build server

The build server is App Engine service `playground-server`, built from `server/` and deployed by
[cicd.yml](../.github/workflows/cicd.yml). This page says how `client-v2`'s production reaches it, which values
connect the two, and how the server's releases move to GitHub Actions and its sign-in to OIDC. How a release goes
live and rolls back is in [Server release](server-release.md). The client's deploy is in
[Deploy the client to Vercel](../client-v2/docs/deploy-client-vercel.md), its production setup in the
[production runbook](../client-v2/docs/production-runbook.md).

## How production reaches it

Production does not send the browser to the build server. It sets
`REACT_APP_SERVER_URL=/api/build-server`, its own route (`client-v2/api/build-server.mjs`),
which forwards each build to `PG_BUILD_SERVER_URL`:

- **Only a signed-in GitHub user builds.** The route checks the Better Auth
  session and `isAllowedOrigin`, as `/api/agent` does. Signed out, it answers
  `401` and the Build stage asks the user to sign in. A deployment without
  sign-in configured refuses every build.
- **Every build is on record.** A `build_audit` row is written before a build
  reaches the build server, so the table needs `yarn db-migrate`. A build
  whose row cannot be written is refused. Each user has one build running and
  a capped number an hour; past either, the route answers `429`.
- **The build server takes only this route.** The route sends
  `PG_BUILD_SERVER_API_KEY` as `x-api-key`. Set it to this deployment's entry
  of the build server's `PG_API_KEYS`. With keys set, the server answers `401`
  to a request without one.
- **`PG_BUILD_SERVER_URL` unset** refuses every build.

The build server bounds each `/build` request to 280 s, queue wait included
(`REQUEST_TIME_LIMIT` in `server/src/routes/build.rs`), sized to fit inside the
route's 300-second `maxDuration` in `client-v2/vercel.json`: change the two
together.

The build server's `PG_CLIENT_URLS` (its CORS list) matters only to a browser
that calls the server directly, as a user who picks it in Settings does. Keep
the production origins in it.

## Values

| Where | Name | Value |
| --- | --- | --- |
| Vercel, Production | `REACT_APP_SERVER_URL` | `/api/build-server`, exactly |
| Vercel, Production | `PG_BUILD_SERVER_URL` | The build server's `https://` origin, no trailing slash |
| Vercel, Production | `PG_BUILD_SERVER_API_KEY` | This deployment's entry of the build server's `PG_API_KEYS` |
| The build server's environment | `PG_API_KEYS` | A comma-separated list of keys, one per client of the server; set it from a GCP secret, never in `app.yaml`. Generate each key with `openssl rand -hex 32`, so every key has one length and holds no space or comma. `PG_BUILD_SERVER_API_KEY` is one entry. Set, the server answers `401` to `/build`, `/deploy` and `/unstable/*` unless `x-api-key` matches an entry, so only a client holding a key gets in. Removing an entry and redeploying the server revokes that client alone: the server reads its keys once, at start. After a change, check each client's key with the `curl` of [D-9](testing.md#d-9-the-server-builds-a-program-without-a-client): a listed key passes, a removed one gets `401`. `PG_API_KEY`, a single key, is read only while `PG_API_KEYS` holds no key: once the list is set, the old key stops working unless it is also an entry, so put the Playground's key in the list and unset `PG_API_KEY` after the move. Either variable set without a key, or with a key holding a space or a character outside visible ASCII, stops the server at start. Both unset, those routes stay open and the server logs an error at start, the one level App Engine prints without `RUST_LOG`. Set `PG_BUILD_SERVER_API_KEY` on Vercel first: a key on the server alone refuses every build, while a key Vercel sends to a server without one is ignored |
| The build server's environment | `PG_CLIENT_URLS` | The production origins, `https://<VERCEL_APP_DOMAIN>` and `https://<CUSTOM_DOMAIN>`. Production's own builds go through `/api/build-server` and do not need it; a user who picks the build server directly in Settings does, or the browser refuses the answers by CORS |
| GitHub, `solana-foundation/solana-playground` → Settings → Secrets and variables → Actions → Repository variables | `GCP_WORKLOAD_IDENTITY_PROVIDER` | The full resource name of the server's Workload Identity provider. Set, the server's deploys and releases sign in to GCP through OIDC; empty, through the `GCP_KEY` secret. The secrets `GCP_KEY`, `SERVICE_ACCOUNT` and `PROJECT_ID` already exist there |

The production runbook says in which of its steps each Vercel value is set and who sets the server's side.

The setup below uses these placeholders:

| Placeholder | What it is |
| --- | --- |
| `<SERVER_PROJECT_ID>` | The Google Cloud project that runs App Engine service `playground-server`, the value of the `PROJECT_ID` Actions secret. May be `<PROJECT_ID>` or another project. Item 1 says how to find it |
| `<SERVER_SA>` | The service account the server deploys as, the value of the `SERVICE_ACCOUNT` Actions secret. Item 1 says how to find it |
| `<PROJECT_ID>` | The Google Cloud project of production's Cloud SQL instance `solpg` ([production runbook, "Values to have ready"](../client-v2/docs/production-runbook.md#values-to-have-ready)) |

## Releases from Actions and sign-in through OIDC

Ticket HOO-484. It needs IAM administration in `<SERVER_PROJECT_ID>` and the right to manage its App Engine traffic.

**What for:** today a tagged commit on `master` parks a new server version with no traffic, and someone with
console rights moves traffic to it, or back, in the GCP console. The deploy signs in with `GCP_KEY`, a
service-account JSON key that never expires and that any workflow file on any branch can read. After this step:

- **Actions → Server: release → Run workflow** on `master` sends all of `playground-server`'s traffic to a named
  version, or rolls back to the one before, and checks that the move took.
- Both that workflow and the deploy sign in through Workload Identity Federation (OIDC), with a short-lived token
  that only `master` of this repository can get. The key is deleted.

**Preconditions:** none of the client's production steps. Until `GCP_WORKLOAD_IDENTITY_PROVIDER` is set, both workflows keep
signing in with `GCP_KEY`, so the **Server: release** workflow already works on the key; items 1 to 4 below move it to
OIDC.

### Run

In one shell:

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
   ([cloud-sql.md](../client-v2/docs/cloud-sql.md)'s Gate 1: no CI identity on the production instance). If the list shows any of them, grant what
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
   re-run the failed **Server: deploy** job. If a release cannot wait for that, grant `roles/editor` back, release, and remove it
   again. A different project holds no Cloud SQL instance of ours, so this paragraph does not apply there.

   **The runtime account too.** The grant above lets the deploy account run server code as `$RUNTIME_SA`, so that
   account must not reach `solpg` either. App Engine's default account (`<SERVER_PROJECT_ID>@appspot.gserviceaccount.com`)
   is often an Editor. The build server holds no database and calls no Google Cloud API, so it needs only to write
   logs and metrics. List the runtime account's roles:

   ```sh
   gcloud projects get-iam-policy "$SERVER_PROJECT_ID" --flatten=bindings \
     --filter="bindings.members:serviceAccount:$RUNTIME_SA" --format='value(bindings.role)'
   ```

   If it holds `roles/editor`, `roles/owner` or any `roles/cloudsql.*`, grant the two it needs, then remove those,
   each with the same `remove-iam-policy-binding` command for `$RUNTIME_SA`:

   ```sh
   for role in roles/logging.logWriter roles/monitoring.metricWriter; do
     gcloud projects add-iam-policy-binding "$SERVER_PROJECT_ID" \
       --member="serviceAccount:$RUNTIME_SA" --role="$role" --condition=None
   done
   ```

   If another App Engine service in the project runs as the same account and needs more, tell Alexander before
   removing anything: the server then needs an account of its own. Check 3 proves the runtime roles as well: the
   new version must start and serve.

3. **Create the pool and provider.** The pool is `github-server`, not `github`: [cloud-sql.md](../client-v2/docs/cloud-sql.md)'s step 9 creates a
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
   `GCP_WORKLOAD_IDENTITY_PROVIDER` ([Values](#values)). From now on a **Server: deploy** or **Server: release** run
   dispatched from any branch but `master` gets no token and fails; run both from `master`.

### Check

1. **OIDC, with nothing moving.** Find the live version:
   `gcloud app versions list --service=playground-server --hide-no-traffic --project="$SERVER_PROJECT_ID"` lists it
   with `TRAFFIC_SPLIT` `1.00` (more than one row: traffic is split; name the version that should have it all in
   the next run). Run **Server: release** on `master` with that version as `version`. The run is green, its annotations
   say `GCP sign-in: Workload Identity Federation`, and its summary says the version `was already live; traffic not
   changed`.
2. **A rollback and back**, if an older version is still serving
   (`gcloud app versions list --service=playground-server --project="$SERVER_PROJECT_ID"`). Run **Server: release** with
   `version` empty: the summary names the live version before and an older one as the target, and says the target
   holds all traffic. Then run it with the version that was live, and check the same. Each move switches the build
   server for every user, so do it when a minute of the older version does no harm. With no older serving version,
   skip this check; the next release proves the move.
3. **The next release.** After the next tagged commit on `master`, the **Server: deploy** run's annotations say
   `GCP sign-in: Workload Identity Federation` and the new version appears, parked, in the version list. The deploy
   step finishes only once the new instances pass App Engine's health check, so a green run also proves the runtime
   account's roles. Move traffic to it as [Server release](server-release.md#going-live-and-rolling-back) says, then build
   a program in the client: the build log shows no error.
4. **No route to `solpg`**, when `<SERVER_PROJECT_ID>` is `<PROJECT_ID>`: this lists nothing, for the deploy and
   the runtime account alike.

   ```sh
   for sa in "$SERVER_SA" "$RUNTIME_SA"; do
     gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
       --filter="bindings.members:serviceAccount:$sa AND bindings.role~^roles/(cloudsql|editor|owner)" \
       --format='table(bindings.role)'
   done
   ```

### If a check fails

- `Permission 'iam.serviceAccounts.getAccessToken' denied` or `unauthorized_client` at the sign-in step: the run
  was not on `master`, or the binding's `REPO_ID` or pool differ from the provider's; compare them with item 3.
- `does not have permission ... appengine.services.update` (or a `403` on `set-traffic`): item 2's role is
  missing.
- A run that refuses its target names why (unknown or stopped version, nothing older, split traffic) and moves
  nothing.
- A run that fails after choosing its target lists in its summary where traffic is now. If it is not where it
  should be, run **Server: release** again with the version that was live, which the summary also names.

### Rollback

Clear the variable `GCP_WORKLOAD_IDENTITY_PROVIDER`; both workflows sign in with `GCP_KEY` again.
This works only until the key is deleted below.

### Retire the key

Once checks 1, 3 and 4 passed:

1. Delete the repository secret `GCP_KEY` on GitHub.
2. Delete the key in GCP. List the account's user-managed keys:
   `gcloud iam service-accounts keys list --iam-account="$SERVER_SA" --managed-by=user`. The one stored as `GCP_KEY`
   has the id in its JSON's `private_key_id`; without the file, and with more than one key listed, ask whoever
   created them before deleting any. Delete it:
   `gcloud iam service-accounts keys delete <key id> --iam-account="$SERVER_SA"`.
3. Tell Alexander: the key path then leaves the workflows' code.
