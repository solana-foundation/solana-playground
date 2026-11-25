# Proposal

## Why

An assistant turn whose settle fails, or whose function ends before the settle
runs, stays `started` for good, and its whole reservation stays held against
the user's daily cap until the UTC day ends (HOO-2996, Sentry
SOLANA-PLAYGROUND-K: a settle 29 s after its reserve could not open a new Cloud
SQL connection within 5 s). The report carried nothing that says why the
connection was slow, so a recurrence cannot be diagnosed.

## What Changes

- A cron route of its own, `api/stale-turns.mjs`, every 6 hours, ends each turn
  still `started` an hour after its reserve as `unfinished`, charged its
  reservation, and moves that reservation from `agent_spend.reserved` into
  `spent`. The day's `spent + reserved`, which the cap reads, does not change.
  It is separate from the retention job, which removes personal data under
  `gdpr-duties`.
- A settle that fails on a connection error reports the pool's state when the
  connect began and where the time went (`ConnectContext`).
- The Cloud SQL pool keeps an unused connection open for the agent route's
  `maxDuration`, so a settle reuses the connection its reserve used. No spec
  names the pool's idle timeout; `design.md` records it.
- Telemetry: no slice under `features/` or `widgets/` gains, renames or loses
  an event, and no funnel step's code changes. The changes are server-side
  (`api/`, the `agent`, `api` and `persistence` server modules).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assistant-default-backend-usage`: "Every admitted turn is recorded" limits
  how long a turn that never settled stays `started`, and a failed settle's
  report carries the connect's state; a new requirement describes the sweep
  that ends such turns.

## Impact

- Code, on the branch of #214: `client-v2/src/features/agent/server/ledger.mjs`
  (`settleStaleTurns`, `STALE_TURN_AGE`), `client-v2/api/stale-turns.mjs`,
  `client-v2/src/features/api/server/cron.mjs` (`refuseCronFor`, the
  `CRON_SECRET` gate moved out of `api/retention.mjs`),
  `client-v2/src/features/persistence/model/providers/cloud-sql.mjs`,
  `client-v2/api/agent.mjs`, `client-v2/vercel.json` (`crons`),
  `client-v2/docs/production-runbook.md`.
- Users: none sees a different budget. A turn that never settled keeps
  counting its reservation against the day's cap, as before; only the row's
  outcome and the split between `reserved` and `spent` change.
- Database: more Cloud SQL connections stay open at once, up to each warm
  instance's `max` for 5 minutes after its last query.
- Operations: the sweep runs only once `CRON_SECRET` is set (HOO-2990).

Out of scope:

- Why a connection through the Cloud SQL connector can take over 5 s. The
  `ConnectContext` of the next failure is the input for that investigation.
- A retry of the settle: it would hide a recurring slow connect.
- The retention job and its `data-retention` spec in `gdpr-duties`: unchanged.
- The pool-size requirement in the `cloud-sql` change's
  `client-v2-production-database` delta: it bounds `max` only, which this
  change keeps.
