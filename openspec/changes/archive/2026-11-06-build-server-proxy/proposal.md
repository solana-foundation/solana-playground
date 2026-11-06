# Proposal

## Why

The Solana Foundation's build server answers anyone who knows its URL, and the
URL ships in the client bundle. Its CORS allowlist stops other sites' pages,
not `curl`. The 29 Oct security review asked for a gate before launch: only a
signed-in GitHub user builds, every build is on record, and the server can be
told to accept nothing but our gate (HOO-2422).

A same-origin proxy was built and rejected once (#22): with the server still
open, a proxy gates nothing. So this change adds both halves, the gate and the
server-side check that makes it the only way in.

## What Changes

- New route `/api/build-server/*` on the client's Vercel deployment. It
  forwards the client's build-server calls (`POST /build`, `GET /deploy/:uuid`
  and their `/unstable` twins) to the build server, and refuses everything
  else.
- **BREAKING (product):** a build or deploy through the route needs a GitHub
  sign-in. A signed-out request gets `401` with `reason: "signed-out"`; the
  Build stage says "Sign in with GitHub to build" and offers the sign-in.
  Slava chose this on 5 Nov over a guest allowance. It contradicts designers'
  specs 02 ACC-03 and 06 RUN-04 ("no sign-in before the first green build"),
  which go to Design alignment as a gap.
- Every build through the route writes one row to a new Postgres table
  `build_audit`: the user, the time, the project (the workspace id and name the
  client sends), the program UUID, the outcome and the duration. A build whose
  row cannot be written is refused (`503`), so no build goes unrecorded.
- The build server gains an optional API-key check: when `PG_API_KEY` is set,
  `/build`, `/deploy` and the unstable routes answer `401` to a request
  without a matching `x-api-key` header. Unset, the server behaves as today.
  The route sends the key from `PG_BUILD_SERVER_API_KEY`.
- The client's default build server, the "Solana Foundation" option, becomes
  the route on its own origin. A profile that stored that option follows it.
  "Local", "SolPg" and a custom URL still go direct.
- Telemetry: no event added, renamed or removed. The Build stage sends no
  product events today, and the new `features/build-server` slice has no user
  actions of its own; the route logs each refusal and failure through
  `shared/lib/logger`.

## Capabilities

### New Capabilities

- `build-server-access`: who may reach the build server, through what, and
  what is recorded about each build.

### Modified Capabilities

None.

## Impact

- `client-v2/api/build-server.mjs` (new), `client-v2/src/features/build-server/`
  (new server model), `client-v2/vercel.json` (one rewrite and a
  `maxDuration` for the route; the build settings are untouched),
  `client-v2/db/migrations` (new table), `client-v2/src/settings/server/`,
  `client-v2/src/utils/server.ts`, the Build stage's failure surface.
- `server/src` (the API-key middleware and its config). The project context
  says `server/` is not modified; this is the exception the ticket needs, an
  additive opt-in check, and it goes into the upstream divergence register.
- Rollout, outside this PR: set `PG_BUILD_SERVER_API_KEY` on Vercel and
  `PG_API_KEY` on App Engine, run the migration on production, redeploy the
  server. Sergey Prokhorov and Alexander own Vercel and GCP configuration.
- Out of scope: rate limits and size limits (HOO-2418), share routes
  (`/new`, `/share`, which production sends to `api.solpg.io`), a guest
  allowance, the D-9 smoke build against the server (HOO-2413 will need the
  key).
