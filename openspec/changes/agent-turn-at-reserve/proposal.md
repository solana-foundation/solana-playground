# Proposal

## Why

`agent_turn` (HOO-2396) gets its row only when a turn settles. A turn whose
function is killed at `maxDuration` never settles, so it leaves no row, and
those are the longest and most expensive turns. The rows also do not say which
model served them, and `PG_AI_MODEL` changes between deploys, so token and
cost figures from different models cannot be told apart. Both are cheapest to
fix before production traffic starts writing rows.

## What Changes

- An admitted turn's `agent_turn` row is written when the turn is reserved,
  in the statement that reserves it, with outcome `started` and the
  reservation as its charge. A turn the cap refuses still writes no row.
- Settling updates that row (outcome, tokens, charge, settle time) in the
  statement that settles `agent_spend`. A row still `started` is a turn that
  never settled.
- Settling a turn twice charges it once; settling a turn whose row is gone
  changes nothing and is logged as a warning.
- Each row names the model the route asked the upstream for.
- `at` becomes the time the turn was reserved, and a new `settled_at` holds
  when it settled, so their difference is the turn's duration.
- No telemetry event is added, renamed or removed: the route is server code
  outside the telemetry layer.

## Capabilities

### New Capabilities

### Modified Capabilities

- `assistant-default-backend-usage`: the "Every admitted turn is recorded"
  requirement moves the row's write from settle to reserve, adds `model`,
  `settled_at` and the `started` outcome, and a failed settle now leaves the
  `started` row instead of none.

## Impact

- `client-v2/db/migrations`: one new migration (`model`, `settled_at`, the
  `started` outcome); `db/schema.sql` regenerated. Production needs
  `migrate-production-db` before the code merges, as for any migration: until
  then every reserve fails and the route answers 503, which a user sees as the
  default backend being unavailable.
- `features/agent/server/ledger.mjs` (`reserve`, `settle`), `api/agent.mjs`,
  their tests, and the runbook's `agent_turn` paragraph in
  `docs/deploy-client-vercel.md`.
- Out of scope: retention of `agent_turn`, a limit on rows written by refused
  or abandoned turns, logging a token count that cannot be stored, and the
  remaining `AGENT_*` names in docs (findings M-1 to M-4 of the HOO-2396
  review).
