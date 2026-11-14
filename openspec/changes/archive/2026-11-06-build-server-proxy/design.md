# Design

## Context

The client calls the build server straight from the browser
(`utils/server.ts`, `PgSettings.server.endpoint`). The Solana Foundation's
server runs on App Engine flex (`server/app.yaml`) and admits browsers by a
CORS prefix list. `api/agent.mjs` already gates a costly upstream on a
Better Auth GitHub session (`readSession`, `isAllowedOrigin`) and keeps its
ledger in the shared Postgres. #22 put a proxy in front and was closed: the
server stayed open, builds hit a 60 s ceiling, and nothing was logged.

## Goals / Non-Goals

**Goals:** the route is the only way to the Foundation's server once the key
is set; one audit row per build; the same build bytes and errors the client
sees today.

**Non-Goals:** rate or size limits (HOO-2418), a guest allowance, changing
`Local`, `SolPg` or a custom server, the share routes.

## Decisions

1. **Path-prefix route, not one function per call.** `/api/build-server/*`
   rewrites to `api/build-server.mjs` with the remainder in `?path=`, the way
   `/api/auth/*` does, so the client keeps treating the route as a server base
   URL and `PgServer` changes only where the base comes from. The dev server
   reaches it through `scripts/api-route.mjs` the same way. Alternative: four
   files (`build`, `deploy`, ...); rejected, it duplicates the gate and needs
   the client to know two URL shapes.

2. **The default option's value is the path `/api/build-server`.** The
   default settings are computed once at build time under Node, where there is
   no origin, and a path resolves against whichever origin serves the client,
   previews included. Settings store the option key (`foundation`), not the
   address, so every profile on that option follows; a stored or configured
   address naming the Foundation's host itself is read as the route
   (`throughRoute`). The upstream address moves to the server side as
   `PG_BUILD_SERVER_URL`, defaulting to the same host, which a test holds
   equal. Alternatives: `window.location.origin` at load (not available where
   the default is computed); `REACT_APP_SERVER_URL` per deployment (previews
   have no fixed URL).

3. **The server check is an API key in a header, set by env.** It reads as
   the ticket's "API-key check switched on by configuration", and it is what
   makes the route the only way in. An axum `from_fn` middleware on the
   build, deploy and unstable routes; share routes stay outside it.
   Constant-time compare without a new crate. `Config`'s `Debug` prints
   `Some(<redacted>)`, since `main` logs the whole config. Alternatives: IAP
   on App Engine (no server code, but a Google identity token per request and
   GCP setup nobody on this PR can make); network allowlist (Vercel has no
   fixed egress without a paid tier).

4. **Audit before the build, completed after; fail closed.** Insert, forward,
   update. A failed insert is `503` and no build. A failed update is logged
   and the response still goes through: the row exists, only its outcome is
   missing. No foreign key to `user`, so the record outlives an account
   delete; the GitHub login is copied in for the same reason.

5. **The project comes in the request body.** The client adds `project:
   {id, name}` to the build JSON. The build server's serde structs ignore
   unknown fields, so direct servers are unaffected, and no custom header
   triggers a CORS preflight on them. The route caps both strings at 200
   characters and records them as the client's claim; the program UUID is the
   server's.

6. **`maxDuration` 300** for the route in `vercel.json` `functions`, as
   `api/agent.mjs` has, so a long build is not cut at the platform default.
   A deploy binary is piped, so it is not held in memory; a build's answer
   (JSON, or an error's text) is read whole, since the audit takes the program
   UUID from it.

7. **The Build stage gets a `signed-out` failure kind.** `buildFailureOf`
   reads it from the error the route returns; the unreached surface shows the
   message and a "Sign in with GitHub" button that calls `PgSession.signIn`.
   No source designs this state (designers' specs forbid it); decided here
   and sent to Design alignment.

8. **Failures the route owns are its own statuses.** The build server
   refusing the route's key (`401`/`403`) is a misconfiguration: `502`,
   reported, never relayed as a refusal the user could act on. An unreachable
   server or a cut-off answer is `502`; a caller who left is recorded as `499`.
   A production deployment without `PG_BUILD_SERVER_API_KEY` reports once per
   instance, so an open server does not go unnoticed.

9. **Shares stay off the route.** In development, while the build server is
   the route, shares go to the share server as they do in production; the
   route forwards builds only.

## Risks / Trade-offs

- Signed-out visitors cannot build at all. Slava's call, 5 Nov.
- Until both keys are set, the server stays open. The route works either way,
  so the order is: merge, set `PG_BUILD_SERVER_API_KEY` on Vercel, then
  `PG_API_KEY` on App Engine and redeploy.
- The route adds a hop and holds a function per build for its whole length.
- HOO-2413's smoke build calls the server directly and will need the key.
