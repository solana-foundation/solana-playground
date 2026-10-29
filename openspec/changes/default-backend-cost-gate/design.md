# Design

## Context

See [proposal.md](proposal.md), "Why", for the threat. The requirements are in
[the spec](specs/assistant-default-backend-spend/spec.md).

State of the route this design starts from:

- `client-v2/api/agent.mjs` relays chat completions to
  `${AGENT_BASE_URL}/chat/completions` with one key (`AGENT_API_KEY`) and a
  model from `agentEnv` (`client-v2/src/shared/config/server-env.mjs`). It
  forwards only `messages`, `tools` and `tool_choice` (`FORWARDED`), and pipes
  the upstream's SSE bytes to the caller without parsing them (`pipeStream`).
- `readSession` (`client-v2/src/features/auth/model/auth.mjs`) returns
  `{ status: "signed-in", user: { id } }`. `user.id` is the key every other
  per-user row uses (projects, conversations). The `account` row for provider
  `github` holds the numeric GitHub id (`accountId`) and the OAuth
  `accessToken`.
- `readJson` reads a body of any size. Vercel stops a body at 4.5 MB.
- The assistant's tool loop runs in the browser. Each step is a separate
  `POST /api/agent`.

## Goals / Non-Goals

**Goals:**

- A total ceiling on spend that holds even when the code in this change has a
  bug.
- Per-user caps that two parallel requests cannot pass together.
- At most one database round trip added before the upstream call and one
  after it, so the gate's latency does not grow with its features.

**Non-Goals:**

- Exact accounting. The Gateway budget is the ceiling. The ledger only has to
  be fair between users, and it may overcharge a user, never undercharge them.
- Limits per request rate. The Vercel Firewall rule `Rate limit /api/agent
  (IP)` in `client-v2/docs/firewall.md` stays the rate limit.

## Decisions

### 1. Vercel AI Gateway is the ceiling

The upstream becomes Vercel AI Gateway's OpenAI-compatible endpoint. The relay
already speaks chat completions to a configurable base URL, so the move is a
change of `AGENT_BASE_URL`, `AGENT_MODEL` and the key. The model
`zai/glm-5.3-flash` is in the Gateway's catalog
([`/v1/models`](https://ai-gateway.vercel.sh/v1/models)). This change is the
project's first use of the Gateway: no team, key or budget exists before task
4.3.

Gateway budgets are set per team, project, API key, or Vercel team member,
reset at UTC day, week or month boundaries, and refuse a request with `402`
`quota_for_entity_exceeded` once spent
([Budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets)).
A budget is soft: the request that crosses it completes. That overshoot is one
turn, bounded by decision 4.

**Billing.** The Gateway charges the serving provider's list price with no
markup ([Pricing](https://vercel.com/docs/ai-gateway/pricing)), from prepaid
Gateway credits. Three settings follow from the budgets being the ceiling:

- **Credits only, no Gateway BYOK.** Gateway BYOK is the Gateway's name for
  registering our own provider credential in the Gateway; it is unrelated to
  the panel's bring-your-own-key backends, which never reach `/api/agent`.
  BYOK spend "does not count toward any budget", so with it the budgets would
  meter and block nothing.
- **The paid tier.** The free tier serves a subset of models at lower rate
  limits. Buying credits moves the team to the paid tier.
- **Auto top-up on.** The team's monthly budget refuses requests before the
  balance can grow the bill past it, so topping up adds no spend beyond the
  ceiling, and it keeps an empty balance from switching the default backend
  off mid-month. An empty balance (`402` `insufficient_funds`) is still
  answered as `pool-exhausted`, the same as a spent budget.

The previous provider's key (Nous Research, the `AGENT_BASE_URL` default in
`agentEnv`) is revoked once the Gateway serves production, so nothing can spend
outside the budgets.

**Routing.** 22 providers serve `zai/glm-5.3-flash` through the Gateway, at
prices from $0.026 to $0.45 per million input tokens, and many keep or train
on prompts or quantize the model. The model id we used with Nous Research,
`z-ai/glm-5.3-flash:US`, kept turns in the US. To keep that, every upstream
request carries `providerOptions: { gateway: { only: [...] } }` with the list
from `AGENT_PROVIDERS`, defaulting to `baseten,fireworks`: on 2026-10-29 the
only endpoints for this model marked US-region, both with zero data retention
and no training, both at $0.15 / $0.50 per million. The Gateway fails over
between the two. `FORWARDED` keeps a caller from sending its own
`providerOptions`. An empty `AGENT_PROVIDERS` sends no restriction.

The default applies only when `AGENT_BASE_URL` is the Gateway
(`ai-gateway.vercel.sh`). Any other upstream gets no `providerOptions` unless
`AGENT_PROVIDERS` names some: Nous Research refuses the field
(`400 unknown_parameter`, seen locally on 2026-10-29), and a deployment that
has not moved to the Gateway yet, or has rolled back, must keep working with
no variable changed.

Alternatives: any provider with zero data retention and no training, in any
region (cheaper, some quantized, data leaves the US); or no restriction (the
Gateway picks among all 22).

Alternatives:

- **A spend limit at the model provider.** Works only for a provider that has
  one, and gives one pool for everyone. Unverified for Nous Research, the
  provider behind the `AGENT_BASE_URL` default in `agentEnv`.
- **Our own global counter only.** A bug in the counter is then a bug in the
  ceiling. The Gateway budget is outside our code.
- **Gateway `user` and `tags` fields.** They feed Custom Reporting and limit
  nothing, so they cannot replace the per-user ledger.

### 2. One Gateway key per tier

`agentEnv` gains a second key, `AGENT_NEWCOMER_API_KEY`. `AGENT_API_KEY` stays
the `established` key. Each key has its own daily budget in the Gateway, and
the team has a monthly budget above both. A sybil attack with new accounts
spends the `newcomer` key's budget and stops there.

Without `AGENT_NEWCOMER_API_KEY`, newcomers spend through `AGENT_API_KEY` and
are still held to the `newcomer` cap. Pools are then shared, and the per-user
caps still apply. `scripts/check-agent-env.mjs` does not require the second key.

Alternative: one key, with a tier field in the ledger and a global per-tier
counter in Postgres. That duplicates the Gateway's metering and loses the
property that the ceiling is outside our code.

### 3. Tier from the GitHub account's creation date, stored at sign-in

A `user` column `githubCreatedAt` (timestamptz, nullable) holds the GitHub
account's `created_at`. The reserve statement of decision 4 reads it and
decides the tier in SQL: `established` when the date is set and older than the
configured newcomer age, `newcomer` otherwise, including when the date is
empty. The route therefore learns the tier from the statement that reserves
the turn, and spends a database round trip on nothing else before the
upstream call.

**At sign-in.** Better Auth already holds the GitHub profile at sign-in, and
GitHub's `/user` response carries `created_at`. `mapProfileToUser` in
`auth.mjs` copies it to `githubCreatedAt` next to `login`. A user who signs in
after this change ships has the date before their first turn, at no cost.

Checked in Better Auth 1.7.5 on 2026-10-29:

- `mapProfileToUser` runs on every sign-in, but what it returns is stored only
  when the user is created: updating an existing user needs
  `overrideUserInfoOnSignIn`, which stays off. That is enough, because
  `created_at` never changes, and the lazy path below covers users created
  earlier.
- Better Auth drops a mapped field declared `input: false`
  (`parseAdditionalUserInputFromProviderProfile`), so `login`, declared that
  way, had never been stored. Both fields are therefore `input: true`, and
  `disabledPaths: ["/update-user"]` removes the one endpoint through which a
  signed-in user could write their own fields. The panel never calls it.
  Without that, a user could set their own `githubCreatedAt` and move
  themselves to the `established` tier. A test asserts the endpoint answers
  404.

**Lazily, for everyone sign-in did not cover.** Two groups reach a turn with
no date: users who signed in before the migration, and users signed in
through the OAuth proxy on a preview, whose sign-in skips `mapProfileToUser`
(see the comment on `socialProviders.github` in `auth.mjs`). One path serves
both. Once `pipeStream` has ended the response, and before the handler
returns, the route reads `GET https://api.github.com/user` with the
`accessToken` of the user's `github` account row and stores `created_at`. The
caller already has its answer, so the lookup adds no latency to any turn and
is outside the goal's bound. A failed or timed-out read stores nothing, and
the next turn tries again. Such a user's turns are `newcomer` until a lookup
succeeds, which is normally their first turn only.

Alternatives:

- **Read the tier in its own query before the reserve.** A second round trip
  on every turn, which the goals rule out.
- **Look the date up before the first reserve.** The first turn waits for
  GitHub, and a slow GitHub delays an answer the user is waiting for.
- **A one-off backfill script for users who signed in before the migration.**
  A second path for a case the lazy path already covers. Without it, each such
  user spends one turn as `newcomer`.
- **More signals** (public repositories, followers). Each is cheap to fake
  next to account age, and account age is the signal bought accounts are
  priced on. Can be added later without changing the spec.
- **GitHub's public `GET /user/{id}` without a token.** Unauthenticated calls
  are limited per IP, and every serverless instance shares Vercel's egress IPs.

### 4. The ledger: reserve, then settle

Table `agent_spend`: `user_id`, `day` (UTC date), `reserved`, `spent`, primary
key `(user_id, day)`. Amounts are integers in micro-USD.

- **Reserve**: one statement. A CTE reads the user's `githubCreatedAt` from
  `"user"` and computes `tier` and `cap` from it, with the newcomer age and
  both caps as parameters. A second CTE inserts the day's row only when
  `$r <= cap`, and on conflict updates it only when
  `spent + reserved + $r <= cap`. The final `SELECT` returns `tier`, whether
  the date is stored, and whether a row was written. It returns the tier when
  the turn is refused too, because the 429 carries it. Postgres row locking
  serialises two concurrent reservations, so parallel turns cannot pass the
  cap together.
- **Worst case `$r`**: input tokens estimated from the body's byte length,
  plus `max_tokens` output tokens, at the configured prices.
- **Settle**: one statement, `reserved = reserved - $r, spent = spent + $charge`,
  with `$charge` from the spec's requirement "A turn is charged what it cost".
  It runs after the response has ended, so it adds no latency either.
- A function that dies between reserve and settle leaves the reservation in
  `reserved` for the rest of the UTC day. The user is overcharged, which the
  Non-Goals allow.

The route asks the upstream for usage on the stream
(`stream_options: { include_usage: true }`), reads the SSE events while piping
them, and takes the last `usage` object. Prices come from configuration
(`AGENT_PRICE_INPUT`, `AGENT_PRICE_OUTPUT`, per million tokens), since the
spec charges for the reported token usage.

Alternative: Upstash Redis. Lower latency per call, but a second store to
provision and operate. Postgres already serves `readSession` on every turn.

### 5. Request bounds

- `AGENT_MAX_BODY_BYTES`: a body over the limit is refused with 413 before
  `readJson` buffers it, using `content-length` and the byte count while
  reading.
- `AGENT_MAX_OUTPUT_TOKENS`: sent as `max_tokens` on every upstream request.
  `FORWARDED` already drops a caller's `max_tokens`.

### 6. Refusal shapes

The route keeps the shape it already uses for `signed-out`: a status, an
`error` sentence, and a `reason` the panel matches on. A `daily-cap` or
`pool-exhausted` refusal also carries the caller's `tier`, which the panel
passes to `agent_refused`. The tier is the caller's own, so it tells the
caller nothing about anyone else.

| Situation | Status | `reason` | `Retry-After` |
| --- | --- | --- | --- |
| Daily cap reached | 429 | `daily-cap` | seconds to 00:00 UTC |
| Gateway key budget spent | 503 | `pool-exhausted` | seconds to 00:00 UTC |
| Body over the limit | 413 | none | none |
| Ledger unavailable | 503 | none | none |

Every day boundary is UTC, the same as the Gateway's daily budgets, so the
user's cap and the tier's pool reset together.

The default backend's error handling in the panel matches `reason` next to the
`signed-out` refusal: the default model provider's `backendRefusal`
(`client-v2/src/views/sidebar/assistant/model/model-providers/default.ts`)
names the refusal, and `provider.ts` acts on it.

### 7. The event lives in `features/agent`

The assistant panel is in the legacy `views/` root and has no tracker, and a
tracker needs a slice with a prefix. `features/agent` already owns the route's
server code, so it gains `index.ts`, `model/telemetry.ts` with
`agentTelemetry`, and the prefix `agent` in `EVENT_PREFIXES`. The panel's
error mapping imports `agentTelemetry` from `@/features/agent` and tracks
`agent_refused` where it matches the `reason`.

Alternative: a new `features/assistant` slice for the panel's events. That is
the slice the panel moves into under `ui-migration`; creating it for one event
would decide its boundary ahead of that change.

## Risks / Trade-offs

- [Both allowed providers fail at once] → turns fail until one recovers.
  Baseten showed 99.10% and Fireworks 99.90% uptime over the day before
  2026-10-29. Adding a provider to `AGENT_PROVIDERS` needs no deploy, only a
  check that it is US-region with zero data retention.
- [A provider leaves the US region or drops zero data retention] → the
  Gateway's endpoint list (`/v1/models/zai/glm-5.3-flash/endpoints`) is the
  source; check it when changing `AGENT_PROVIDERS` or the model.
- [Shared office or VPN IPs] → unchanged by this design. Per-user caps key on
  `user.id`, not the IP.
- [Sybil accounts older than the configured age] → bought aged accounts reach
  the `established` pool. The `established` key's daily budget bounds the
  damage to that pool for one day, and `[EMERGENCY] Deny /api/agent` in
  `client-v2/docs/firewall.md` stops it at once.
- [`user.id` is not the GitHub id] → no account-deletion path exists, so one
  GitHub account maps to one `user.id`. A future account deletion has to keep
  the ledger keyed so that a re-created account does not get a fresh cap.
- [Estimated input tokens are wrong] → the estimate only sizes the
  reservation. The charge comes from reported usage, and a turn with no
  reported usage is charged the reservation.

## Migration Plan

1. Migration: `agent_spend` table and `user."githubCreatedAt"`. Regenerate
   `db/schema.sql`. Run `migrate-production-db` before merging to `master`.
2. A person buys Gateway credits, turns on auto top-up, creates the two
   Gateway keys and the budgets, and sets `AGENT_BASE_URL`, `AGENT_MODEL`,
   `AGENT_API_KEY`, `AGENT_NEWCOMER_API_KEY` and the limit variables in
   Vercel.
3. Merge. With the new variables absent the route uses defaults, so the order
   of steps 2 and 3 does not matter for availability.
4. After a day of production traffic through the Gateway, revoke the Nous
   Research key.

Rollback: before step 4, restore the previous `AGENT_BASE_URL`, `AGENT_MODEL`
and `AGENT_API_KEY` values; with a non-Gateway base URL no routing restriction
is sent. The ledger keeps working against any upstream that
reports usage on the stream. After step 4, rollback needs a new Nous Research
key.

## Starting values

Derived from the Gateway's list price for `zai/glm-5.3-flash` on 2026-10-28:
$0.15 per million input tokens, $0.50 per million output tokens. Cached input
is billed lower; the ledger charges every input token at the full price, which
overcharges, as the Non-Goals allow. The code takes each value from the
environment, with these as the defaults. Read `agent_refused` after a week and
adjust.

| Setting | Value | Reason |
| --- | --- | --- |
| `AGENT_PRICE_INPUT` | 0.15 (USD per million) | Gateway list price |
| `AGENT_PRICE_OUTPUT` | 0.50 (USD per million) | Gateway list price |
| `AGENT_MAX_BODY_BYTES` | 524288 (512 KB) | About 128k input tokens at 4 bytes per token |
| `AGENT_MAX_OUTPUT_TOKENS` | 8192 | Room for a long answer with `low` reasoning |
| `AGENT_PROVIDERS` | `baseten,fireworks` on the Gateway, none elsewhere | The US-region, zero-data-retention endpoints (decision 1) |
| Newcomer account age | under 30 days | A month of account history before the larger cap |
| `newcomer` daily cap per user | $0.10 | About 20 typical steps |
| `established` daily cap per user | $0.50 | About 100 typical steps |
| `newcomer` key daily budget (Gateway) | $10 | 100 newcomers at their cap |
| `established` key daily budget (Gateway) | $50 | 100 established users at their cap |
| Team monthly budget (Gateway) | $1,500 | Both keys at their daily budget for 25 days |

How the numbers follow from the price:

- **Worst-case turn:** 128k input tokens ($0.0192) plus 8192 output tokens
  ($0.0041), about $0.023. That amount is the reservation for a body at the
  limit, and the most one turn can overshoot a Gateway budget.
- **Typical step:** about 25k input and 1.5k output tokens, about $0.0045.
  This is an estimate of the panel's prompt, tools and history, not a
  measurement. `agent_refused` and the Gateway logs replace it.
- **Sybil cost:** a newcomer account yields at most $0.10 a day, and all
  newcomers together at most $10 a day. Reaching the `established` pool needs
  accounts older than 30 days, and that pool is bounded at $50 a day.
- **Worst month:** $1,500, the team budget, whatever the per-key budgets add
  up to.

## Open Questions

- Whether the charge can use a cost the Gateway reports in the stream
  instead of the price variables. **Open: the field exists but is not
  documented.** A local run on 2026-10-29 against a free-tier model
  (`nvidia/nemotron-3.5-lightning-free`) ended with a `usage` that carries
  `cost`, `market_cost` and `cost_details`, all 0 for that model. The
  Chat Completions pages document `usage` in the OpenAI shape, tokens only;
  the documented cost of a turn is `total_cost` from
  `GET /v1/generation?id=...`, a separate request per turn that the goals
  rule out. Until then the charge stays tokens at the price variables, and
  the Gateway budgets stay the exact ceiling. Task 4.4 compares, on a paid
  model, a turn's streamed `usage.cost` with its `total_cost` from the
  lookup. If they agree, a follow-up can charge `usage.cost` when present and
  fall back to the price variables when absent (any upstream other than the
  Gateway); the variables then only bound the reservation.
