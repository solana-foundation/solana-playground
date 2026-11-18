# Design

## Context

See proposal.md, "Why". `/api/build-server` (#119, HOO-2422) already checks the
session and writes one `build_audit` row per build before calling the build
server. The build server (#174, HOO-2874) gives each request
`REQUEST_TIME_LIMIT` from its arrival, the wait for a slot included, and runs
`PG_BUILD_CONCURRENCY` builds at once on one App Engine instance. The client
already has one refusal that is not a failed build: the sign-in refusal
(`reason: "signed-out"`), which the Build stage shows as a prompt.

## Goals / Non-Goals

**Goals:**

- One client path for both limits, so the Build stage, the terminal, Deploy's
  stale-build guard and telemetry treat a busy answer the same whichever side
  refused.
- Each limit enforced where the facts live: the per-user count in the route,
  which knows the user; the queue bound in the build server, which alone knows
  how many requests wait.

**Non-Goals:**

- An exact per-user count under concurrency (see Risks).
- Carrying a busy refusal through `deploy-finish` or the tutorial runner
  (proposal.md, Impact).

## Decisions

- **A busy refusal is a `429` or `503` that carries `Retry-After`.** The
  header, not the status alone, is the marker: the route already answers
  `503` for "sign-in unavailable" and "no build server configured", and those
  must stay failures. `getBusyRetryAfter` (`client-v2/src/utils/busy-refusal.ts`)
  reads it by shape, as `isSignInRefusalError` does, so a rethrown or mocked
  error still reads as one. Alternative rejected: a `reason` field in the JSON
  body. The build server's `503` is plain text, and a JSON contract between
  the Rust server and the client would be a second protocol for one bit.
- **The two statuses share one surface on purpose.** For the person both mean
  "wait this long, then build again"; the answer's own words say which limit
  it was. A build server `503` without the route's JSON words shows
  `BUSY_SERVER_MESSAGE`, not the server's log text.
- **The per-user count reads `build_audit`, not a counter of its own.** The
  route already writes a row per build, and `build_audit_user_at_idx` covers
  both queries (running, and the last hour). A row with no status counts as
  running only within the route's `maxDuration`
  (`BUILD_MAX_DURATION_SECONDS`, which a test ties to `client-v2/vercel.json`),
  so a function that died does not lock its user out. A failed count answers
  `503`, the same fail-closed choice as a failed audit write. Alternative
  rejected: an in-memory or Redis counter, which serverless instances do not
  share and the project does not run.
- **The queue bound uses a guard that releases on every way out.**
  `Permit::acquire` takes a free slot at once; otherwise a `Waiting` guard
  reserves a place up to `max_waiting` and waits at most `max_wait`. Dropping
  the guard (slot taken, timeout, caller gone) frees the place, so no exit path
  leaks one. `REQUEST_TIME_LIMIT` still caps wait plus build, so raising
  `PG_BUILD_QUEUE_WAIT_SECS` cannot push a request past the route's
  `maxDuration`.
- **`build_failed` gains a reason value, not an event.** The Build funnel step
  keeps its events (`build_started`, `build_succeeded`, `build_failed`); a
  new `reason: "busy"` separates turned-away builds from broken ones without
  changing the funnel table. `build_started` still fires, since the user did
  press Build.
- **`server/` changes are the fork's, on record.** `openspec/config.yaml`'s
  context says `server/` is not modified, which #174 already broke. The
  context is updated to point at the root `CLAUDE.md` "Gotchas" entry that
  lists the fork-owned server changes an upstream sync must keep.

## Risks / Trade-offs

- [Two builds arriving within milliseconds both pass the per-user count,
  since the count and the insert are separate statements] → The limit bounds
  fairness, not an exact count. A transaction or advisory lock would close it;
  the route's `query` dependency offers neither, and one extra build is
  harmless.
- [The limit values are guesses: 1 running, 20 per hour, a queue of 6, a 60 s
  wait] → Each is a named constant (`MAX_RUNNING_BUILDS`,
  `MAX_BUILDS_PER_HOUR`) or an environment setting (`PG_BUILD_QUEUE_LIMIT`,
  `PG_BUILD_QUEUE_WAIT_SECS` in `server/app.yaml`); `build_failed` with
  `reason: "busy"` shows how often they turn builds away.
- [An upstream sync takes upstream's `server/` files on a conflict and drops
  the queue bound] → The root `CLAUDE.md` "Gotchas" entry names the files and
  says a conflict there is resolved by hand.

## Migration Plan

No data migration. The server's new settings have defaults, so an instance
without them in `app.yaml` behaves as configured here. Rollback is a revert:
the client treats a busy answer as a refusal only when `Retry-After` is
present, so an older server or route simply never sends one.
