# Design

## Context

See proposal.md, Why. `reserve` and `settle` in
`client-v2/src/features/agent/server/ledger.mjs` each borrow a client from the
shared pool. The Cloud SQL pool (`createPool` in
`client-v2/src/features/persistence/model/providers/cloud-sql.mjs`) took its
limits from `POOL_LIMITS` in `url.mjs`: `idleTimeoutMillis` 10 s,
`connectionTimeoutMillis` 5 s. A turn longer than 10 s therefore settled on a
new connection, which goes through Workload Identity Federation, a client
certificate and a TLS stream to the connector front end. `connectionTimeoutMillis`
bounds only `pg`'s part of that; the pool's `renew` wait comes before it. The
only cron route, `api/retention.mjs`, belongs to `gdpr-duties`.

## Goals / Non-Goals

**Goals:**

- A settle after a turn shorter than the route's `maxDuration` reuses an open
  connection.
- The next failed connect says whether a client was idle and where the time
  went.
- A turn that never settled ends with a charge that never undercharges.

**Non-Goals:**

- Finding why a connect took over 5 s: this change collects the evidence.
- Returning budget to a user: the sweep cannot know what a dead turn cost.

## Decisions

- **Idle timeout = the agent route's `maxDuration` (300 s), Cloud SQL only.**
  `IDLE_TIMEOUT_MS` in `cloud-sql.mjs` overrides `POOL_LIMITS` for that
  provider; the `url` provider keeps 10 s, since Neon and the local
  containers pool in front of the database. Rejected: a retry of the settle,
  which spends another `connectionTimeoutMillis` on the same slow path and
  hides how often it happens; a longer `connectionTimeoutMillis`, which hides
  the slowness the same way.
- **`ConnectContext` on the error, set by the pool's `connect`.** The renewing
  pool already wraps both forms of `connect` (`pg-pool`'s `query` uses the
  callback form), so it snapshots `idleCount`, `totalCount`, `waitingCount`
  and the connector's age before awaiting `renew`, and times `renew` and
  `pg`'s connect apart. The error object reaches the route unchanged through
  `run`, and the settle's report adds `e.connect` to its context. Rejected:
  timing in the route, which cannot see the pool's counts or split the
  renewal from the socket.
- **The sweep ends turns as `unfinished`, charged their reservation.** It
  matches `chargeFor` for a turn that reported no usage, and the
  `agent_turn_at_reserve` migration's down step, which keeps an unsettled
  turn as `unfinished` at its reservation. Rejected: `abandoned`, which means
  the turn sent nothing and charges 0, an undercharge; releasing the
  reservation, the same undercharge.
- **Reservations summed per user and day before `agent_spend` is updated.**
  An `update ... from` that matches one `agent_spend` row to several turns
  applies only one of them. A settle racing the sweep waits on the turn's row
  lock, then finds it no longer `started`, so a turn is charged once.
- **`STALE_TURN_AGE` = 1 hour**, far past `maxDuration`, so no live route can
  still settle the turn. The age changes no budget, so it needs no tuning.
- **A cron route of its own, `api/stale-turns.mjs`, every 6 hours.** The
  sweep is ledger bookkeeping; the retention job removes personal data under
  `gdpr-duties` and keeps its three steps and response. The team's Vercel plan
  is Enterprise, so a cron more often than daily is allowed. The
  `CRON_SECRET` gate moves unchanged from `api/retention.mjs` into
  `refuseCronFor` (`client-v2/src/features/api/server/cron.mjs`), so both
  routes refuse alike. Rejected: a fourth retention step, which contradicted
  the `data-retention` delta of `gdpr-duties` and mixed the two jobs.

## Risks / Trade-offs

- [More Cloud SQL connections open at once: each warm instance holds up to
  `max` (3) for 5 minutes after its last query] → `max` is unchanged, so the
  ceiling of instances × `max` that `client-v2-production-database` bounds
  (in the `cloud-sql` change) still holds; only how often it is reached
  rises. Watch the instance's connection count after release.
- [A held connection dies while the instance is frozen, and a query gets
  "Connection terminated unexpectedly"] → the same risk existed within 10 s;
  `pg-pool` drops a client that emits an error. A recurrence shows in Sentry
  under the route that ran the query.
- [The sweep does not run while `CRON_SECRET` is unset] → the route answers
  `503` and reports it; HOO-2990 sets the secret.

## Migration Plan

No schema change: the `unfinished` outcome and `settled_at` exist. Deploy
with #214. Rows left `started` before the deploy are ended by the first run.
Rollback: revert #214; rows the sweep ended stay `unfinished` and charged,
which no code reads differently.
