# Deploy the client to Vercel

Vercel's native Git integration auto-deploys: `master` → production (the integration branch); any other branch → preview. Those builds use the dashboard's Root Directory, which must be `client-v2` — while it is `client`, **pushes deploy the upstream client, not `client-v2`**. Makefile targets pin `client-v2` themselves and work either way — see [Which client gets deployed](#which-client-gets-deployed).

## Release checklist: `client-v2` to production

Nothing below has been run end to end yet — see [Known gaps](#known-gaps). The
order is the point: each step assumes the ones above it, and steps 1–7 come
**before** the first production build of `client-v2`. `master` already
holds the persistence code, so any push to it — or a redeploy — ships that code
as soon as the Root Directory points at `client-v2`.

1. **One-time setup is done** — [below](#one-time-setup). In particular
   `preview-base` must already exist *before* step 6, or every later preview
   inherits production's tables.
2. **Production env vars**, scoped to Production —
   [Assistant default backend](#assistant-default-backend) and
   [Conversation and project sync](#conversation-and-project-sync):
   - `DATABASE_URL` — the pooled URL of the parent Neon database, the same one
     `migrate-production-db` migrates.
   - `SYNC_ENABLED=true`.
   - `AUTH_SECRET` — generated for production, never reused from a preview.
   - `AUTH_BASE_URL` — the production origin. **Required here, not optional:**
     without it `resolveBaseURL()` (`src/features/auth/model/auth.mjs`) falls
     back to `VERCEL_URL`, the per-deployment hostname, so the session cookie
     and the origin checks (`isAllowedOrigin`) in `api/agent.mjs`,
     `api/mcp.mjs`, `api/projects.mjs` and `api/conversations.mjs` are issued
     for a host nobody visits. A production build with `AGENT_API_KEY` fails
     without it (`scripts/check-agent-env.mjs`).
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — see step 3.
   - `AGENT_*`: set only after sign-in (`AUTH_SECRET`, `GITHUB_CLIENT_ID`,
     `GITHUB_CLIENT_SECRET`, `DATABASE_URL`) and the [firewall](firewall.md)
     rules. `/api/agent` answers only signed-in users, and a production build
     fails when the key is set without sign-in or `AUTH_BASE_URL`
     (`scripts/check-agent-env.mjs`).
3. **GitHub OAuth app for production.** Its callback URL is
   `<AUTH_BASE_URL>/api/auth/callback/github`. A GitHub OAuth app takes a
   single callback, so production gets its own app rather than sharing a
   preview's.
4. **Build server CORS.** `PG_CLIENT_URLS` on the build server includes the
   production origin.
5. **Dry run on a preview**, from `master`:

   ```sh
   make -f client-v2/Makefile.vercel migrate-preview-db
   make -f client-v2/Makefile.vercel deploy-client-to-vercel-preview
   ```

   This uses the Neon branch `preview/master`. On the preview URL:
   `/api/sync` answers `{"enabled":true,"db":"ok"}`, sign-in works, and a
   project edited in one browser shows up in a second.
6. **Migrate production:**

   ```sh
   make -f client-v2/Makefile.vercel migrate-production-db
   ```

   A deployment that ships ahead of its migration runs against a schema
   missing what it expects — and `/api/sync` still reports `db: "ok"`, because
   it checks reachability, not schema.
7. **Dashboard settings.** Production Branch `master`; Root Directory →
   `client-v2`; the Ignored Build Step still lets `master` through.
8. **Deploy.** Redeploy the latest `master` commit from the dashboard, or
   push to `master`.
9. **Smoke test production** the same way as step 5.

Rolling back the deployment (`vercel promote <previous-url> --prod`) does not
roll back the schema. Migrations are additive so far, so the previous build
runs against the newer schema; revisit this once one is not.

`installCommand` = `bash scripts/vercel-install.sh` (rustup + `wasm/build.sh` + `yarn install`); `buildCommand` = `yarn build:bundle`, not `yarn build`, which would compile the wasm packages a second time and miss the install step's cache. Wasm must precede `yarn install` because `client-v2/package.json` has `file://../wasm/*/pkg` deps that don't exist until `wasm-pack` runs.

## Verified Vercel project settings

| Setting | Value |
| --- | --- |
| Plan / Build Machine | Enterprise + **Enhanced** |
| Framework Preset | Other |
| Root Directory | `client` — intended `client-v2`, not yet changed |
| Production Branch | `master-2.0`; switch to `master` once `master-2.0` is merged into `master` |
| Ignored Build Step | Automatic |

## How long a function may run

`vercel.json` sets `functions."api/agent.mjs".maxDuration = 300`. That
route streams a model's answer, so it is the only one that can outlive a
default; every other `api/*.mjs` handler answers in one round trip and
keeps the platform default.

**Why 300 and not less.** A value in `vercel.json` overrides the
platform default in *both* directions, and which default applies depends
on a project setting nobody has checked here:

| Compute mode | Default | Max (Enterprise) |
| --- | --- | --- |
| Fluid (on by default for projects created since ~2025-04) | 300 s | 800 s |
| Legacy serverless | 15 s | 900 s |

On legacy, 15 s cuts a long streamed answer off mid-sentence, which is
what this setting exists to prevent. On Fluid, a smaller number would
*lower* a limit that is already fine — a `maxDuration` of 60 would have
introduced the very truncation it was meant to fix. 300 is the one value
that is right under either reading: it raises the legacy default and
matches the Fluid one.

**Open, and needs the dashboard:** confirm whether this project runs
Fluid compute (Settings → Functions). Once known, this number can be
chosen on evidence rather than on the safe overlap.

A cut-off stream is not silent on the client side either: `api/agent.mjs`
aborts the upstream request when the browser goes away, and reports a
failed stream as an SSE `error` event rather than ending quietly.

## Which client gets deployed

The dashboard and the Makefile currently disagree, on purpose:

| Path | Root Directory used | Deploys |
| --- | --- | --- |
| `git push` (Git integration) | dashboard: `client` | upstream client |
| `make -f client-v2/Makefile.vercel deploy-client-to-vercel-preview` | pinned to `client-v2` | the fork's client |

`vercel build` takes the built directory from `settings.rootDirectory` in `.vercel/project.json`, which `vercel pull` caches from the dashboard. `vercel.json` has no `rootDirectory` key, so the dashboard is the only source for the Git path. `vercel-link-preview` rewrites the cached value to `client-v2` after every pull — that is what makes the local target build the fork while pushes do not.

Setting the dashboard Root Directory to `client-v2` makes both paths agree; the rewrite then becomes a no-op and can be dropped.

## One-time setup

1. Create the project. Framework: Other. Root Directory: `client-v2`.
2. Build Machine: Enhanced on Enterprise; default on Pro.
3. Production Branch: `master`. Ignored Build Step: Automatic.
4. A Vercel token, only if you need one — see [Tokens](#tokens). Local deploys do not: the Makefile targets fall back to your `vercel login` session.
5. Link the local checkout (from repo root):

   ```sh
   VERCEL_PROJECT_ID=prj_xxx make -f client-v2/Makefile.vercel vercel-bootstrap
   ```

   The root `Makefile` includes `client-v2/Makefile.vercel`, so a bare `make <target>` from the repo root runs the same targets, and `make help` lists them.
6. Neon: set `NEON_API_KEY` and `NEON_PROJECT_ID` in `client-v2/.env` and on GitHub (a secret and a variable), then cut `preview-base` **before** anything migrates the shared database. Both steps are in [Neon preview databases](neon.md#configuration).

Add the Vercel deployment origin to the server's [`PG_CLIENT_URLS`](https://github.com/solana-playground/solana-playground/blob/cd5555155c61572c8c49fb351890519af9e493ef/.env.example#L3) environment variable or CORS will reject every request.

## Deploy

- **Automatic:** push the branch — but this builds `client`, not `client-v2`, until the dashboard Root Directory is changed.
- **Local preview:** `make -f client-v2/Makefile.vercel deploy-client-to-vercel-preview`. Promote later with `vercel promote <url> --prod`.
- **Local production:** `make -f client-v2/Makefile.vercel deploy-client-to-vercel-production`. The target prints the branch and commit, asks for a typed `yes`, and then runs `vercel build --prod` and `vercel deploy --prebuilt --prod`. Run `migrate-production-db` first when migrations are pending.
- **Local production, fast:** `make -f client-v2/Makefile.vercel deploy-client-to-vercel-prod-fast`. Rebuilds from the working tree in ~5 minutes by skipping `installCommand` (rustup + `wasm/build.sh`, about an hour). It refuses to run unless a previous full build left `client-v2/node_modules` and the real — not stubbed — `wasm/*/pkg` packages on disk. It deploys whatever is in the working tree, committed or not.

`vercel-link-preview` or `vercel-link-production` runs automatically as a prerequisite of the preview and full production targets.

A Git-integration build with no cache does not finish inside Vercel's [build time limit](https://vercel.com/docs/builds#limits-and-resources). A local build has no such limit, and it reuses the Rust state of earlier local builds (see [Build cache](#build-cache)).

To pick up only changed **server-side** variables (anything `api/*.mjs` reads), no rebuild is needed: re-run `npx vercel@<version> deploy --prebuilt --prod --archive=tgz` on the existing `.vercel/output`, with the version pinned as `VERCEL_CLI` in `Makefile.vercel`. Variables are attached to functions when a deployment is created. `REACT_APP_*` are inlined into the bundle and do need a rebuild.

The deploy resolves this git branch's Neon branch first, before building, and passes it as `-e DATABASE_URL=<pooled url>` so the deployment overrides the project-level variable. Resolving first is deliberate: a Neon failure should not cost a full wasm build.

`--archive=tgz` is not optional. The prebuilt output is about 16k files and the upload API rejects more than 15000 (`files should NOT have more than 15000 items`), so the tree goes up as a single tarball.

## Build cache

Three caches, one per part of the install:

| What | Where | Why there |
| --- | --- | --- |
| `node_modules` | Vercel's [build cache](https://vercel.com/docs/deployments/troubleshoot-a-build) | Vercel restores it before the install. `yarn install` is skipped when the restored copy was installed from the same `yarn.lock`, `package.json`, wasm packages, and Node version (`node_modules/.cache/install-key`). |
| The built `wasm/*/pkg` directories | Vercel [Remote Cache](https://vercel.com/docs/monorepos/remote-caching), with a copy in `node_modules/.cache/wasm-pkg` | The build cache is saved only by a successful build, and a build that compiles the wasm packages does not finish in time. Remote Cache takes the upload mid-build. |
| The default crates in `public/crates` (`DEFAULT_CRATE_FILES` in `scripts/vercel-install.sh`) | Vercel Remote Cache, with a copy in `node_modules/.cache/default-crates` | Generating them installs a Rust toolchain and compiles `syn-file-expand-cli`. A hit needs no Rust. |

The default crates follow the same order as the wasm packages: the local copy, then Remote Cache, then `scripts/generate-default-crates.mjs`; `vercel-install.sh` uploads the result before `yarn install`. Their key is derived from the generator's (`generate-default-crates.mjs --key`), which hashes the script, `wasm/rust-analyzer/rust-toolchain.toml`, and the brotli version bundled with Node. During the build, `yarn generate` runs the generator again; it finds `public/crates/.default-crates-key` current and skips.

The supported crates (every other file in `public/crates`) are not cached. `yarn generate` runs `scripts/generate-crates.mjs` in every build, with the Rust in Vercel's image: `cargo fetch --locked` downloads the crates of `server/programs/Cargo.lock` (about 800 MB), the script compiles `syn-file-expand-cli`, and the expansion takes seconds. Locally on 16 cores that was 22.6 s, 11.9 s, and 1.6 s; on Vercel's 4 cores, 20 to 26 s in all (preview `dpl_DHaCX3RVDt1xfDXgffFETouqGBti`). `cargo fetch` is the only step that puts those crates on Vercel; without them the editor receives `index.html` for each crate and Rust Analyzer panics. The script fails the build when a supported crate is missing.

`scripts/vercel-install.sh` stores the wasm packages as one tar named by a hash of every file under `wasm/` except build output. Any change under `wasm/` produces a new hash and rebuilds every wasm package. The tar is looked up locally first, then in Remote Cache. On a miss the script builds, writes both, and only then runs `yarn install` and the client build, so a build that later exceeds the time limit still leaves the tar for the next one. A build that finds the tar locally uploads it when Remote Cache lacks it. An upload failure prints a warning and the build continues.

Remote Cache is reached through its [artifacts API](https://vercel.com/docs/rest-api/artifacts/upload-a-cache-artifact). The script expects the credentials in `VERCEL_ARTIFACTS_TOKEN` and `VERCEL_ARTIFACTS_OWNER`, and the build log says which of the two were set. Without the token only the local tar is used.

Rust state (toolchains, cargo registry, and target dir) lives in `client-v2/.cache/rust`, outside `node_modules`. It is larger than the build cache size limit, so on Vercel it is empty at the start of every build. Locally it persists.

## Tokens

`Makefile.vercel` passes `--token` only when `VERCEL_TOKEN` is set. Unset, the
CLI uses the session from `vercel login`, so local deploys need no token at all.

The targets that link first (`vercel-link-preview`, `vercel-link-production`,
and the preview and full production deploys) run `vercel whoami` with the same
credentials, and stop with the fix when they are rejected. Run
`make -f client-v2/Makefile.vercel vercel-auth` to run only that check.

`vercel-bootstrap` is the exception to both: it calls the REST API with `curl`,
and a raw HTTP request has no stored login to fall back on.

**A project-scoped token cannot drive the CLI.** Choosing a single project in
Account Settings → Tokens creates one, and it denies every user-level request.
The CLI calls `/v2/user` and `/v3/user/tokens/current` on startup and enumerates
`/v9/projects?limit=100`, so it fails with a message that blames the wrong thing:

```text
Error: Could not retrieve Project Settings. To link your Project, remove the `.vercel` directory and deploy again.
```

The `.vercel` directory is fine. The tell is that the same token works for
`vercel-bootstrap`, because `/v9/projects/<id>` is project-level — when `curl`
succeeds and the CLI does not, suspect the scope, not the link.

Selecting **All Projects** creates a team-scoped token, which does work, at the
cost of org-wide CLI access. Vercel has had project-scoped CLI support open since
July 2025; the documented `--project` flag still answers `projectId is not
supported (400)`.

CI needs no Vercel token today, because no workflow deploys. Vercel's Git
integration builds on Vercel's own infrastructure, authenticated through the
GitHub app connection.

## Assistant default backend

`api/agent.mjs` is the assistant's **Default** backend: the panel posts a
chat-completions turn to it and the route forwards that upstream with a key the
browser never sees. The key enables the Default backend; without one the option reports itself
unconfigured and the panel falls back to bring-your-own-key. A Vercel build
without the key fails: `vercel.json`'s `buildCommand` runs
`scripts/check-agent-env.mjs` first, so set the key for Production and Preview
alike. Store it as a Secret. A production build also fails when the key is set
without sign-in's variables or without a parseable `AUTH_BASE_URL`. On Vercel's
build machine (`CI` set) an empty value counts as unset, as it does at runtime.
A local `vercel build` (the `Makefile.vercel` deploy targets) pulls a Secret as
an empty value; there the check accepts an empty value and warns, since the
deployment reads the real value at runtime:

| Variable | Meaning |
| --- | --- |
| `AGENT_API_KEY` | Bearer token for the upstream. Required on Vercel |
| `AGENT_BASE_URL` | Optional, defaults to `https://inference-api.nousresearch.com/v1`. OpenAI-compatible base URL, used as given: no trailing slash and no `/chat/completions`, which the server appends |
| `AGENT_MODEL` | Optional, defaults to `z-ai/glm-5.3-flash:US`. Model id the upstream runs. The client never picks one. Ids: [Nous catalogue](https://inference-api.nousresearch.com/v1/models) |
| `AGENT_REASONING_EFFORT` | Optional, defaults to `low`. Sent as `reasoning_effort`; accepted values are the model's `reasoning.supported_efforts` in the [Nous catalogue](https://inference-api.nousresearch.com/v1/models). The panel shows no reasoning, so a high effort looks like a stalled answer |

The defaults for model and effort are Nous-specific: pointing `AGENT_BASE_URL`
elsewhere usually means setting both as well.

Only a signed-in user spends the key. `POST /api/agent` refuses before it reads
the body or calls the upstream:

| Answer | When |
| --- | --- |
| `403` | The `Origin` header names another site (`isAllowedOrigin`, as the sync routes use) |
| `503` | Sign-in is not configured: `SIGN_IN_ENV` in `src/features/auth/config.mjs` names the variables, all listed under [Conversation and project sync](#conversation-and-project-sync) |
| `503` | The session lookup failed, a database or Better Auth outage; logged as `auth: session lookup failed` |
| `401` | No Better Auth session |

The `403` compares against `AUTH_BASE_URL` (or `VERCEL_URL`), as on the sync
routes: a page opened on another hostname of the same deployment, such as a
branch alias or a `www` domain, gets `403` on turns and sync writes.

An upstream that refuses the key with `401` or `403` is answered `502` and
logged as `agent: upstream refused the key`, so the panel never reads it as its
own sign-in or origin refusal. Other upstream errors, `429` included, keep their
status.

`GET /api/agent` reports `configured: false` while sign-in is not configured, so
the panel never offers a backend that would refuse every turn. Sign-in limits who
spends the key, not how much: per-session and daily caps are HOO-1751, and the
request rate per client is capped by the [firewall](firewall.md) rules.

## Conversation and project sync

Off unless configured, and off again the moment `SYNC_ENABLED` is not exactly
`true`. The client asks `/api/sync` first and stays purely local when the
answer is no, so a deployment without a database behaves exactly as it did
before this existed.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. **Must be a pooled endpoint.** A serverless function opens a connection per invocation and will exhaust `max_connections` against a direct one. TLS is required and the certificate verified unless the URL sets `sslmode` — so a provider needing a looser mode has to say so in the URL, where it is visible in review |
| `SYNC_ENABLED` | Kill switch. Only the exact string `true` enables sync; unset or anything else keeps the app local-only |
| `AUTH_SECRET` | Better Auth signing secret. Generate one per environment; rotating it signs everyone out |
| `AUTH_BASE_URL` | The deployment's own origin, e.g. `https://example.vercel.app`. Better Auth builds the OAuth callback from it, so a wrong value breaks sign-in with no error at the browser |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | The OAuth app. Its callback URL must match `AUTH_BASE_URL` |

**Migrations are applied by hand, never by a function.** Every preview gets its
own Neon branch, so its schema is its own problem:

```sh
make -f client-v2/Makefile.vercel migrate-preview-db
```

What that target does to the preview's Neon branch, and why it asks for no
confirmation, is in [Neon preview databases](neon.md#a-branch-per-git-branch).

The shared database behind the project-level `DATABASE_URL` still needs its own
schema, and that one serves production:

```sh
make -f client-v2/Makefile.vercel migrate-production-db
```

It pulls the **Production** environment's `DATABASE_URL_UNPOOLED` into
`.vercel/.env.production.local` and migrates that — never the preview pull,
which is resolved for the checked-out git branch and so can name a preview
branch's database instead (it did: run from `master-2.0` it checked
`preview/master-2.0` and reported nothing pending while `main` had no schema).
It prints the target host first, then the pending migrations, then requires a
typed `yes`. It skips the prompt entirely when nothing is pending, so the warning
never becomes something to click through.

**Nothing applies migrations automatically, in any environment.** CI runs
`yarn db-migrate` only against its own throwaway service container
(`client-v2.yml:101`), which proves the history replays from scratch but touches
nothing real. The Git integration deploys `master` to production with no
hook before or after it. Production is therefore migrated by a person running
`migrate-production-db` from a laptop, and the ordering is theirs to get right:
migrate first, then merge to `master`. A deployment that ships ahead of its migration runs
against a schema missing the columns it expects.

A preview deployment pointed at a database that has not been migrated will
answer `db: "unreachable"` from `/api/sync` and stay local, which is the
intended failure rather than a broken app. Note the limit of that: it covers a
database that cannot be reached, not one whose schema is merely out of date.

### Known gaps

- **No signed-in end-to-end coverage.** The e2e suite runs signed out, so the
  sync paths it exercises are the ones that decline to do anything. Two-browser
  behaviour has only been checked by hand.
- **`/api/agent` has no spend cap per user.** A signed-in user can spend the
  key without limit apart from the firewall's request rate. See
  [Assistant default backend](#assistant-default-backend).
- The deployed-preview reachability of `DATABASE_URL` has not been verified;
  everything so far has run against a local container.
- **No deployment has ever succeeded.** Of the last 100, all were Git-triggered:
  98 cancelled by the Ignored Build Step (`exit 0` for anything that is not
  production, so preview builds are switched off at the project level) and 2
  errored on `master`. The Makefile has never produced one.
- **The Neon targets are untested against real Neon.** See
  [Neon preview databases](neon.md#known-gaps).

## Endpoint routing

- All non-share routes → the hardcoded Solana Foundation server URL in `client-v2/src/settings/server/server.ts` (also user-overridable via the `server.endpoint` setting), so forks can point at their own backend.
- Share routes (`/share/*`, `/new`) → hardcoded `https://api.solpg.io` so shared snippets stay discoverable across hosts.
