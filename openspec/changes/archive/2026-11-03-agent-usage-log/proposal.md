# Proposal

## Why

The default backend's quota per GitHub account is provisional: HOO-1751's
`reserve` holds each user to a daily cap by tier, read from env. The real shape
(window, unit, value) is to be set from recorded usage, and nothing records it:
`agent_spend` keeps one micro-USD sum per user per UTC day, with no request
count, no tokens and no window shorter than a day. A turn the cap refuses
leaves no trace at all. Separately, the route relays up to 300 characters of
an upstream error body to the caller and the server log unredacted, so an
upstream that echoes the key would hand it out. This is HOO-2396.

## What Changes

- New table `agent_turn`: one row per admitted `/api/agent` turn, with its
  day, time, tier, outcome, reported tokens and charge.
- `settle` writes the row in the statement it already runs, so the route
  makes no extra round trip. A turn the cap refuses adds one to a new
  `agent_spend.capped` count instead of a row.
- Every text the route relays or logs about an upstream failure is cut to
  300 characters and has the hosted keys redacted: the error body passthrough, the 401/403 and 402 logs,
  `Upstream unreachable` and the stream's error frame.
- `client-v2/docs/deploy-client-vercel.md` gains the procedure for rotating the
  hosted keys.
- Telemetry: none added, renamed or removed. `features/agent`'s server code
  changes; its browser events (`agent_refused`) do not.

## Capabilities

### New Capabilities

- `assistant-default-backend-usage`: what `/api/agent` records about each
  turn, and what it never lets out about its keys.

### Modified Capabilities

None. The cost gate's capability (`assistant-default-backend-spend`, in
change `default-backend-cost-gate`) is unarchived; this change adds its own
so the two archive independently.

## Impact

- `client-v2/db/migrations`, `db/schema.sql`: one migration, one table, run
  before the code merges (the settle statement writes to it).
- `client-v2/src/features/agent/server/ledger.mjs`, a new `redact.mjs` beside
  it, `client-v2/api/agent.mjs`.
- User-visible consequence: none in the panel. Operators can read usage per
  account in any window, and an upstream error can no longer show the key.
- Out of scope: the quota's final shape and value, any change to `reserve` or
  the tiers, a retention job for `agent_turn` (decided with the shape), paid
  tiers, bring-your-own-key, and confirming the Firewall rule is on in
  production (a person checks it in the Vercel dashboard).
