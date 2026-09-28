# Deploy the client to Vercel

Vercel's native Git integration auto-deploys: `master-2.0` → production (the fork's integration branch, switched from `master` on 2026-09-25); any other branch → preview. Those builds use the dashboard's Root Directory, which must be `client-v2` — while it is `client`, **pushes deploy the upstream client, not `client-v2`**. Makefile targets pin `client-v2` themselves and work either way — see [Which client gets deployed](#which-client-gets-deployed).

## Release checklist: `client-v2` to production

Nothing below has been run end to end yet — see [Known gaps](#known-gaps). The
order is the point: each step assumes the ones above it, and steps 1–7 come
**before** the first production build of `client-v2`. `master-2.0` already
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
     and the write-origin checks in `api/projects.mjs` and
     `api/conversations.mjs` are issued for a host nobody visits.
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — see step 3.
   - `AGENT_*` — only once `/api/agent` has something in front of it.
3. **GitHub OAuth app for production.** Its callback URL is
   `<AUTH_BASE_URL>/api/auth/callback/github`. A GitHub OAuth app takes a
   single callback, so production gets its own app rather than sharing a
   preview's.
4. **Build server CORS.** `PG_CLIENT_URLS` on the build server includes the
   production origin.
5. **Dry run on a preview**, from `master-2.0`:

   ```sh
   make -f client-v2/Makefile.vercel migrate-preview-db
   make -f client-v2/Makefile.vercel deploy-client-to-vercel-preview
   ```

   This uses the Neon branch `preview/master-2.0`. On the preview URL:
   `/api/sync` answers `{"enabled":true,"db":"ok"}`, sign-in works, and a
   project edited in one browser shows up in a second.
6. **Migrate production:**

   ```sh
   make -f client-v2/Makefile.vercel migrate-production-db
   ```

   A deployment that ships ahead of its migration runs against a schema
   missing what it expects — and `/api/sync` still reports `db: "ok"`, because
   it checks reachability, not schema.
7. **Dashboard settings.** Production Branch `master-2.0`; Root Directory →
   `client-v2`; the Ignored Build Step still lets `master-2.0` through.
8. **Deploy.** Redeploy the latest `master-2.0` commit from the dashboard, or
   push to `master-2.0`.
9. **Smoke test production** the same way as step 5.

Rolling back the deployment (`vercel promote <previous-url> --prod`) does not
roll back the schema. Migrations are additive so far, so the previous build
runs against the newer schema; revisit this once one is not.

`installCommand` = `bash scripts/vercel-install.sh` (rustup + `wasm/build.sh` + `yarn install`); `buildCommand` = `yarn build`. Wasm must precede `yarn install` because `client-v2/package.json` has `file://../wasm/*/pkg` deps that don't exist until `wasm-pack` runs.

## Verified Vercel project settings

| Setting | Value |
| --- | --- |
| Plan / Build Machine | Enterprise + **Enhanced** |
| Framework Preset | Other |
| Root Directory | `client` — intended `client-v2`, not yet changed |
| Production Branch | `master-2.0` — switched from `master` on 2026-09-25 |
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
3. Production Branch: `master-2.0`. Ignored Build Step: Automatic.
4. A Vercel token, only if you need one — see [Tokens](#tokens). Local deploys do not: the Makefile targets fall back to your `vercel login` session.
5. Link the local checkout (from repo root):

   ```sh
   VERCEL_PROJECT_ID=prj_xxx make -f client-v2/Makefile.vercel vercel-bootstrap
   ```

   `-f` matters: the root `Makefile` still includes `client/Makefile.vercel`, so a bare `make <target>` runs the pre-move targets and deploys the upstream client.
6. Neon console → the org named `Vercel: Hoodies` → Settings → API keys → Create new → Project-scoped, for project `spring-cake-75618686`. Put it in `client-v2/.env` as `NEON_API_KEY=...`, alongside `DATABASE_URL` — `Makefile.vercel` lifts it out of there, because make does not read `.env` the way dbmate does. A Vercel-managed Neon account has no CLI login — `neon login` cannot work — so this key is the only way the Makefile reaches the Neon API, and only org Admins can mint one. The token is shown once.
7. Cut the empty parent that every preview database branches from, **before** anything migrates the shared database:

   ```sh
   make -f client-v2/Makefile.vercel neon-preview-base
   ```

   Order matters: `preview-base` is useful only because it is empty. Cut it after `migrate-production-db` and every preview inherits tables that dbmate then tries to create again.

Add the Vercel deployment origin to the server's [`PG_CLIENT_URLS`](https://github.com/solana-playground/solana-playground/blob/cd5555155c61572c8c49fb351890519af9e493ef/.env.example#L3) environment variable or CORS will reject every request.

## Deploy

- **Automatic:** push the branch — but this builds `client`, not `client-v2`, until the dashboard Root Directory is changed.
- **Local preview:** `make -f client-v2/Makefile.vercel deploy-client-to-vercel-preview`. Promote later with `vercel promote <url> --prod`.

- **Local production, fast:** `make -f client-v2/Makefile.vercel deploy-client-to-vercel-prod-fast`. Rebuilds from the working tree in ~5 minutes by skipping `installCommand` (rustup + `wasm/build.sh`, about an hour). It refuses to run unless a previous full build left `client-v2/node_modules` and the real — not stubbed — `wasm/*/pkg` packages on disk. It deploys whatever is in the working tree, committed or not.

`vercel-link-preview` runs automatically as a prerequisite of the preview target.

To pick up only changed **server-side** variables (anything `api/*.mjs` reads), no rebuild is needed: re-run `npx vercel@latest deploy --prebuilt --prod --archive=tgz` on the existing `.vercel/output`. Variables are attached to functions when a deployment is created. `REACT_APP_*` are inlined into the bundle and do need a rebuild.

The deploy resolves this git branch's Neon branch first, before building, and passes it as `-e DATABASE_URL=<pooled url>` so the deployment overrides the project-level variable. Resolving first is deliberate: a Neon failure should not cost a full wasm build.

`--archive=tgz` is not optional. The prebuilt output is about 16k files and the upload API rejects more than 15000 (`files should NOT have more than 15000 items`), so the tree goes up as a single tarball.

## Tokens

`Makefile.vercel` passes `--token` only when `VERCEL_TOKEN` is set. Unset, the
CLI uses the session from `vercel login`, so local deploys need no token at all.
`vercel-bootstrap` is the exception — it calls the REST API with `curl`, and a
raw HTTP request has no stored login to fall back on.

**A project-scoped token cannot drive the CLI.** Choosing a single project in
Account Settings → Tokens creates one, and it denies every user-level request.
The CLI calls `/v2/user` and `/v3/user/tokens/current` on startup and enumerates
`/v9/projects?limit=100`, so it fails with a message that blames the wrong thing:

```
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
browser never sees. Set all three or the option reports itself unconfigured and
the panel falls back to bring-your-own-key:

| Variable | Meaning |
|---|---|
| `AGENT_BASE_URL` | OpenAI-compatible base URL, e.g. `https://api.openai.com/v1` — the same shape the panel's own provider field takes. A pasted `/chat/completions` suffix is tolerated |
| `AGENT_MODEL` | Model id the upstream should run — the client never picks one |
| `AGENT_API_KEY` | Bearer token for the upstream; omit only for an endpoint that checks none |
| `AGENT_ENABLED` | Optional kill switch. `false`, `0`, `off` or `no` disables the backend even when the three above are set; unset means on |

There is no cost gate in front of this route. Anything that can reach the
deployment can spend that key, so put a challenge and a per-session limit
in front of it before pointing it at a paid account.

## Conversation and project sync

Off unless configured, and off again the moment `SYNC_ENABLED` is not exactly
`true`. The client asks `/api/sync` first and stays purely local when the
answer is no, so a deployment without a database behaves exactly as it did
before this existed.

| Variable | Meaning |
|---|---|
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

That creates `preview/<git-branch>` from `preview-base` on first use and applies
the whole migration history to it. Because the branch belongs to one git branch
and nothing else reads it, there is no confirmation prompt and a bad migration
costs a `neon branches delete`, not an incident. Two people testing two
migrations can no longer corrupt each other, which was the case before preview
and production shared a single database.

Previews branch from `preview-base` rather than from the default branch for two
reasons. A plain copy-on-write branch would carry production's rows into every
preview. A `--schema-only` branch would carry the tables but leave
`schema_migrations` empty, so dbmate would try to create tables that already
exist. An empty parent avoids both.

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
nothing real. The Git integration deploys `master-2.0` to production with no
hook before or after it. Production is therefore migrated by a person running
`migrate-production-db` from a laptop, and the ordering is theirs to get right:
migrate first, then merge to `master-2.0`. A deployment that ships ahead of its migration runs
against a schema missing the columns it expects.

A preview deployment pointed at a database that has not been migrated will
answer `db: "unreachable"` from `/api/sync` and stay local, which is the
intended failure rather than a broken app. Note the limit of that: it covers a
database that cannot be reached, not one whose schema is merely out of date.

### Known gaps

- **No signed-in end-to-end coverage.** The e2e suite runs signed out, so the
  sync paths it exercises are the ones that decline to do anything. Two-browser
  behaviour has only been checked by hand.
- **`/api/agent` is still ungated** — see the section above. Sync does not
  change that.
- The deployed-preview reachability of `DATABASE_URL` has not been verified;
  everything so far has run against a local container.
- **No deployment has ever succeeded.** Of the last 100, all were Git-triggered:
  98 cancelled by the Ignored Build Step (`exit 0` for anything that is not
  production, so preview builds are switched off at the project level) and 2
  errored on `master`. The Makefile has never produced one.
- **The Neon calls are untested against real Neon.** `neon-preview-base`,
  `preview-db-branch` and `migrate-preview-db` were exercised with a stubbed
  `neonctl` against a local Postgres, which proves the arguments and the shell
  but not that the Neon API accepts them. `neon-preview-base` is the smallest
  real call and fails fastest.

## Endpoint routing

- All non-share routes → the hardcoded Solana Foundation server URL in `client-v2/src/settings/server/server.ts` (also user-overridable via the `server.endpoint` setting), so forks can point at their own backend.
- Share routes (`/share/*`, `/new`) → hardcoded `https://api.solpg.io` so shared snippets stay discoverable across hosts.
