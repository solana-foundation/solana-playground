# Design

## Context

`server/` serves the stable routes `/build`, `/deploy/{uuid}`, `/share/{id}` and `/new`, plus `/unstable/*` in a
build with the `unstable` feature. Only the two share routes touch MongoDB, through `server/src/db.rs`. `main.rs`
calls `db::init` at start-up. The MongoDB driver connects lazily, so a server with no MongoDB starts, and only a
share request fails.

client-v2 sends share requests through `PgServer.shareGet` and `PgServer.shareNew`. Their `useDbServer` option
points both at `https://api.solpg.io` in a production build. Nothing in client-v2 reaches either method: the route
`routes/share/share.tsx` returns `false` from `validate`, and nothing imports `Modals/Share.tsx`. Routes are
collected from the folders under `src/routes/` into the generated `routes/generated.ts`
(`scripts/generate-exports.mjs`).

The project constraints in `openspec/config.yaml` say `server/` is not modified. This change edits it on purpose.
The fork deploys this server as its production build backend, as the open change `stable-anchor-1-1-2` (#140) also
does.

## Goals / Non-Goals

**Goals:**

- The server binary has no database code, setting, or dependency.
- No code in client-v2 names a server share route.

**Non-Goals:**

- Moving sharing to Postgres or anywhere else: gists already cover it (`openspec/specs/gist-sharing`).
- Changing `client/`, which stays byte-identical to upstream.
- Merging the compose services `server` and `server-standalone`, which differ by profile and image name.

## Decisions

- **Delete the routes, do not gate them behind a Cargo feature.** A feature would keep the driver and `db.rs`
  compiling in CI's clippy run for a route no deployment can serve. Upstream keeps its own copy if it wants one.
- **404 from the router's default fallback, not an explicit 410.** No client of this fork calls the routes, and
  upstream's `client/` sends production share requests to `https://api.solpg.io`, not to this server. A dedicated
  handler would be code that only documents a removal.
- **Remove the client-v2 code, do not keep it for later.** `PgShare` and the modal compile against routes that no
  longer exist. Keeping them invites someone to turn the route back on and get 404s. The test in
  `widgets/home/model/start-view.test.ts` that sets `pathname` to `/share/abc` uses the path as an arbitrary
  temporary project, not the share route, and stays as it is.
- **compose keeps both server services.** `server` loses `depends_on: db` and `PG_DB_URI`, and the comment on
  `server-standalone` stops giving MongoDB as its reason to exist. The comment on `postgres` stops contrasting it
  with `db`.
- **docs/testing.md:** case D-4 (share round trip) is deleted. D-1 no longer expects `db` or checks for a MongoDB
  connection error, the D-6 note about D-4 goes, U-2 drops its MongoDB precondition, and section 2's list of
  requests that need the server names only `/build` and `/deploy/{uuid}`. C-2 keeps Share for `client/`, whose
  request still fails cleanly without a server.

## Risks / Trade-offs

- [PR 140 edits `server/src/main.rs`, `server/src/config.rs` and `server/Cargo.lock` too] → whichever PR merges
  second rebases. `server/Cargo.lock` is regenerated with `cargo update --workspace` rather than merged by hand.
- [A hand-set `PG_DB_URI` on App Engine stays in the service config] → the server ignores it. Removing it from
  the service is a console step, not part of this change.
- [Someone runs `client/` from the `dev` profile and clicks Share] → the request returns 404 and the client shows
  its error. The proposal's Impact records this.

## Migration Plan

Merge, then deploy the server as usual with `cicd.yml`. No data moves: no deployment held MongoDB data. Rollback
is a revert of the PR.
