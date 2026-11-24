# Proposal

## Why

The Solana Foundation's build server had no bound on who keeps its slots busy
or on how many requests wait for one. One signed-in GitHub account could start
builds back to back and keep every slot taken (HOO-2907). Under load, a request
waited in the server's queue until `REQUEST_TIME_LIMIT` (280 s, #174) ran out,
and the user saw a failed build after almost five minutes (HOO-2908). Both
cases mean "the service is busy", but the user was told their build failed.

The code for both tickets is written on #182; this change records the
behaviour in the specs, which describe `/api/build-server` and the build
server but not their limits.

## What Changes

- `/api/build-server` limits each signed-in GitHub user to
  `MAX_RUNNING_BUILDS` (1) running build and `MAX_BUILDS_PER_HOUR` (20) builds
  per hour, counted from `build_audit`. A build over either limit is answered
  `429` with `Retry-After` and `reason: "build-limit"`, writes no audit row and
  never reaches the build server. A row whose function died stops counting as
  running after the route's `maxDuration`.
- The build server lets at most `PG_BUILD_QUEUE_LIMIT` (6) requests wait for a
  build slot, each for at most `PG_BUILD_QUEUE_WAIT_SECS` (60 s). Past either
  bound it answers `503` with `Retry-After` at once, and the request takes no
  slot. `/api/build-server` relays that `503` with its `Retry-After`, and does
  not report it as a server error.
- The Build stage shows a `429` or `503` that carries `Retry-After` as "Builds
  are busy, retry in N s", counting down to "try again now", with one "Try
  again" button. It is not a failed build: the stage keeps its last settled
  state, the terminal prints the refusal as a plain line, and Deploy does not
  ship an older binary for this source. A `503` without `Retry-After` (sign-in
  unavailable, no build server configured) stays an ordinary failure.
- Telemetry: `build_failed` (`features/program-build`, the Build funnel step's
  failure event) gains the reason value `busy` for a build turned away by
  either limit. A busy refusal sends `build_failed { framework, reason: "busy"
  }` in place of `reason: "server"`. `build_started` and `build_succeeded` are
  kept as they are, and no event is added or renamed.
- `openspec/config.yaml`'s context says `server/` is not modified. The fork
  owns the build server's request path since #174, and this change adds to it;
  the context is brought in line with the "Gotchas" entry of the root
  `CLAUDE.md`, which lists the fork-owned server changes an upstream sync must
  keep.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `build-server-access`: adds the per-user build limits; the route relays a
  busy server's `Retry-After`; a refused build writes no audit row; the Build
  stage's busy surface.
- `build-server`: adds the bounded wait for a build slot and its `503` with
  `Retry-After`.
- `client-v2-build`: `build_failed` reports a busy refusal as `reason: "busy"`.

## Impact

- Code: `client-v2/api/build-server.mjs`,
  `client-v2/src/features/build-server/server/limits.mjs`,
  `client-v2/src/utils/busy-refusal.ts`, `server-error.ts`, `server.ts`,
  `client-v2/src/views/flow/` (stage state, `BaseBuild`, console status),
  `client-v2/src/commands/build/build.ts`,
  `client-v2/src/features/program-build/model/telemetry.ts`; in `server/`,
  `routes/build.rs`, `error.rs`, `config.rs`, `main.rs`,
  `middlewares/cors.rs` and `app.yaml`.
- Users: a user past a limit, or arriving while the queue is full, waits the
  seconds the answer names instead of watching a build fail after minutes.
- Data: no migration. The count reads `build_audit` through the existing
  `build_audit_user_at_idx`.
- Out of scope:
  - a deploy whose build step is turned away as busy still shows "Deploy
    failed"; only the sign-in refusal is carried to the Build stage from
    `deploy-finish`;
  - the tutorial runner (`features/tutorial-conversation`) handles a busy
    refusal as a failed build and reports it to Sentry;
  - an allowance for guests, more instances or more slots;
  - an exact per-user count: the count and the audit insert are separate
    statements, so two builds arriving within milliseconds can both pass.
