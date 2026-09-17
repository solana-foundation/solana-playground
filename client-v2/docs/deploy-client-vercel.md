# Deploy the client to Vercel

Vercel's native Git integration auto-deploys: `master` → production; any other branch → preview. Those builds use the dashboard's Root Directory, which is still `client`, so **pushes currently deploy the upstream client, not `client-v2`**. Makefile targets exist as a local escape hatch and pin `client-v2` themselves — see [Which client gets deployed](#which-client-gets-deployed).

`installCommand` = `bash scripts/vercel-install.sh` (rustup + `wasm/build.sh` + `yarn install`); `buildCommand` = `yarn build`. Wasm must precede `yarn install` because `client-v2/package.json` has `file://../wasm/*/pkg` deps that don't exist until `wasm-pack` runs.

## Verified Vercel project settings

| Setting | Value |
| --- | --- |
| Plan / Build Machine | Enterprise + **Enhanced** |
| Framework Preset | Other |
| Root Directory | `client` — intended `client-v2`, not yet changed |
| Production Branch | `master` |
| Ignored Build Step | Automatic |

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
4. Account Settings → Tokens: team-scoped token, `export VERCEL_TOKEN=...` locally for the Makefile targets.
5. Link the local checkout (from repo root):

   ```sh
   VERCEL_PROJECT_ID=prj_xxx make -f client-v2/Makefile.vercel vercel-bootstrap
   ```

   `-f` matters: the root `Makefile` still includes `client/Makefile.vercel`, so a bare `make <target>` runs the pre-move targets and deploys the upstream client.

Add the Vercel deployment origin to the server's [`PG_CLIENT_URLS`](https://github.com/solana-playground/solana-playground/blob/cd5555155c61572c8c49fb351890519af9e493ef/.env.example#L3) environment variable or CORS will reject every request.

## Deploy

- **Automatic:** push the branch — but this builds `client`, not `client-v2`, until the dashboard Root Directory is changed.
- **Local preview:** `VERCEL_TOKEN=<token> make -f client-v2/Makefile.vercel deploy-client-to-vercel-preview`. Promote later with `vercel promote <url> --prod`.

`vercel-link-preview` runs automatically as a prerequisite. Local production deploys are intentionally not supported — production goes out only via the `master` Git integration.

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

**Migrations are applied by hand, never by a function.** Before turning
`SYNC_ENABLED` on for an environment:

```sh
DATABASE_URL=<that environment's url> yarn db-migrate
```

A preview deployment pointed at a database that has not been migrated will
answer `db: "unreachable"` from `/api/sync` and stay local, which is the
intended failure rather than a broken app.

### Known gaps

- **No signed-in end-to-end coverage.** The e2e suite runs signed out, so the
  sync paths it exercises are the ones that decline to do anything. Two-browser
  behaviour has only been checked by hand.
- **`/api/agent` is still ungated** — see the section above. Sync does not
  change that.
- The deployed-preview reachability of `DATABASE_URL` has not been verified;
  everything so far has run against a local container.

## Endpoint routing

- All non-share routes → the hardcoded Solana Foundation server URL in `client-v2/src/settings/server/server.ts` (also user-overridable via the `server.endpoint` setting), so forks can point at their own backend.
- Share routes (`/share/*`, `/new`) → hardcoded `https://api.solpg.io` so shared snippets stay discoverable across hosts.
