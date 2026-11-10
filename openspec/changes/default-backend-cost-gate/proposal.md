# Proposal

## Why

`POST /api/agent` spends the deployment's model key for any signed-in GitHub
user, with no ceiling on spend per user or in total (HOO-1751). Sign-in
(HOO-2101) bounds who can spend the key, not how much. Total spend grows with
the number of accounts that pass sign-in, and an attacker can create or buy
GitHub accounts, so per-user caps alone cannot bound the bill. This change adds
a hard total ceiling, per-user daily caps, account tiers that keep new
accounts away from the established users' allowance, and bounds on the size of
one request.

## What Changes

- The default backend's upstream stays Nous Research, where the client holds
  prepaid credits. Each tier's Nous key carries a daily and a monthly spend
  limit, set in the Nous dashboard, so total spend has a ceiling that holds
  even when our own accounting is wrong, and the prepaid balance, with no
  auto top-up, bounds everything beyond that.
- Vercel AI Gateway stays supported as a fallback upstream, reached by
  configuration alone, for when the Nous credits are used up. A Gateway
  upstream is restricted to US-region providers that retain no data and do
  not train on it, keeping the US-only serving the Nous model id (`:US`)
  gives.
- Signed-in users fall into two tiers, `newcomer` and `established`, by the age
  of their GitHub account. Each tier spends through its own upstream key, so
  when new accounts exhaust their key's daily limit, established users still
  have theirs.
- `/api/agent` keeps a per-user, per-day spend ledger in Postgres. A turn
  reserves its worst-case cost before the upstream call and settles to the
  cost the upstream reports when the stream ends. A turn that would pass the
  user's daily cap is refused with 429 and `reason: "daily-cap"` before the
  upstream is called.
- An upstream `402` (a key's spend limit reached, `key_spend_limit_reached`,
  or the credit balance empty) reaches the panel as 503 with
  `reason: "pool-exhausted"` and the upstream's `Retry-After`, not as
  `Upstream 402: ...`. An empty balance is also reported to Sentry, since
  only a person adding credits brings the backend back.
- `/api/agent` refuses a request whose body is larger than a configured limit
  (413), and sets `max_completion_tokens` on every upstream request, so the worst-case
  cost of one turn is known before the call.
- The panel shows a plain sentence for `daily-cap` and `pool-exhausted`, says
  when the default backend is available again, and points at the key-based
  backends.
- HOO-1788 needs no new token: the Better Auth session, which `readSession`
  already verifies, is the session token, and `user.id` is the limit key.
- Telemetry: `features/agent` gains browser code, a tracker in
  `model/telemetry.ts`, and the event prefix `agent`. The change adds one
  event, `agent_refused`, tracked when the default backend refuses a turn with
  `daily-cap` or `pool-exhausted`, with parameters `reason` and `tier`. It
  shows how often each tier reaches each limit, which is the input for
  setting the caps. It renames and removes no events. Usage events are
  HOO-2078.

## Capabilities

### New Capabilities

- `assistant-default-backend-spend`: how much a signed-in user may spend
  through the default backend per day, how one request's cost is bounded, how
  account tiers share the total, and what the panel says when a limit is
  reached.

### Modified Capabilities

None. `assistant-own-key` keeps its requirement that the default backend needs
a signed-in user. This change adds limits for the signed-in user.

## Impact

- Code: `client-v2/api/agent.mjs`, `client-v2/src/features/agent/` (ledger,
  tier lookup, request bounds; `index.ts` and `model/telemetry.ts` for the
  event), `client-v2/src/shared/lib/telemetry/prefixes.ts` (prefix `agent`),
  `client-v2/src/shared/config/server-env.mjs` (`agentEnv`), the default
  backend's error mapping in the assistant panel.
- Database: one migration adds the ledger table and a user field for the
  GitHub account's creation date; `db/schema.sql` is regenerated.
- Operations: a person creates the two Nous keys with their daily and
  monthly spend limits, sets the new environment variables in Vercel, records
  the starting values in `client-v2/docs/deploy-client-vercel.md`, and owns
  topping up the prepaid balance. The Gateway setup stays documented there as
  the fallback. No agent handles the keys.
- User-visible: a signed-in user who reaches the daily cap sees why and that
  it resets at 00:00 UTC; one whose tier's pool is empty sees why and is told
  to try again later. Both can switch to a key-based backend. A key-based
  backend is not affected.
- Out of scope:
  - Kora paymaster deploys (HOO-1787) and their identity, which wait on the
    Kora team's answer on how the deployer identifies a user.
  - A system prompt owned by the server, and dropping the client's `system`
    messages and tools. The panel builds the prompt and the tool list, and
    moving them to the server is a separate change.
  - A cap on tool-loop steps. The loop runs in the browser, so each step is a
    separate request to `/api/agent`, and the daily cap already bounds them.
  - An allowlist of users with a larger cap.
  - Changes to the Vercel Firewall rules in `client-v2/docs/firewall.md`.
