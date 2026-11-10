# Design

## Context

See [proposal.md](proposal.md), "Why", for the threat. The requirements are in
[the spec](specs/assistant-default-backend-spend/spec.md).

State of the route this design starts from:

- `client-v2/api/agent.mjs` relays chat completions to
  `${PG_AI_BASE_URL}/chat/completions` with one key (`PG_AI_API_KEY`) and a
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

- Exact accounting. The upstream's key limits are the ceiling. The ledger only has to
  be fair between users, and it may overcharge a user, never undercharge them.
- Limits per request rate. The Vercel Firewall rule `Rate limit /api/agent
  (IP)` in `client-v2/docs/firewall.md` stays the rate limit.

## Decisions

### 1. Nous key limits are the ceiling

The upstream stays Nous Research (`PG_AI_BASE_URL`'s default in `agentEnv`),
where the client holds prepaid credits. The design first moved it to Vercel
AI Gateway; that path stays supported as the fallback below, for when the Nous
credits are used up.

What Nous gives, as of 2026-11-10:

- **A spend limit per key, daily and monthly**, set in the Nous dashboard. A
  key past its limit is refused with `402` and `"code":
  "key_spend_limit_reached"`.
- **The daily limit is a rolling window** that starts with the key's first
  request, not a fixed boundary. The refusal carries `Retry-After`, the only
  place the route learns when the key spends again.
- **A prepaid balance with no auto top-up.** An empty balance refuses every
  key with `402`; the Nous Portal documents the code
  `insufficient_credits_for_paid_model`, unconfirmed on the inference API.
  Since the balance is prepaid, it is the outer bound on spend even if every
  key limit were wrong.
- **No API for a key's limit or the balance**: `/v1/key`, `/v1/auth/key` and
  `/v1/credits` answer 404. Both are read in the dashboard only.
- **The streamed `usage` carries the turn's cost** (decision 4).

**US serving.** The model id `z-ai/glm-5.3-flash:US` is, by the Nous
catalogue, the Fireworks-hosted US SKU, so turns stay in the US with no
routing field. Nous refuses `providerOptions` (`400 unknown_parameter`), so
none is sent to it.

#### Fallback: Vercel AI Gateway

Moving to the Gateway is a change of `PG_AI_BASE_URL`, `PG_AI_MODEL` and the
two keys, with no code. The model `zai/glm-5.3-flash` is in the Gateway's
catalog ([`/v1/models`](https://ai-gateway.vercel.sh/v1/models)). No team,
key or budget exists yet; `client-v2/docs/deploy-client-vercel.md` holds the
setup.

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

The Nous keys are revoked once the Gateway serves production, so nothing can
spend outside the budgets.

**Routing.** 22 providers serve `zai/glm-5.3-flash` through the Gateway, at
prices from $0.026 to $0.45 per million input tokens, and many keep or train
on prompts or quantize the model. The model id we used with Nous Research,
`z-ai/glm-5.3-flash:US`, kept turns in the US. To keep that, every upstream
request carries `providerOptions: { gateway: { only: [...] } }` with the list
from `PG_AI_PROVIDERS`, defaulting to `baseten,fireworks`: on 2026-10-29 the
only endpoints for this model marked US-region, both with zero data retention
and no training, both at $0.15 / $0.50 per million. The Gateway fails over
between the two. `FORWARDED` keeps a caller from sending its own
`providerOptions`. An empty `PG_AI_PROVIDERS` sends no restriction.

The default applies only when `PG_AI_BASE_URL` is the Gateway
(`ai-gateway.vercel.sh`). Any other upstream gets no `providerOptions` unless
`PG_AI_PROVIDERS` names some: Nous Research refuses the field
(`400 unknown_parameter`, seen locally on 2026-10-29), and a deployment that
has not moved to the Gateway yet, or has rolled back, must keep working with
no variable changed.

Alternatives: any provider with zero data retention and no training, in any
region (cheaper, some quantized, data leaves the US); or no restriction (the
Gateway picks among all 22).

Alternatives to the upstream's limits as the ceiling:

- **Move to the Gateway now.** Its budgets are the same kind of ceiling, but
  the client's prepaid Nous credits would go unused.
- **Our own global counter only.** A bug in the counter is then a bug in the
  ceiling. The key limits and the prepaid balance are outside our code.
- **Gateway `user` and `tags` fields.** They feed Custom Reporting and limit
  nothing, so they cannot replace the per-user ledger.

### 2. One upstream key per tier

`agentEnv` gains a second key, `PG_AI_NEWCOMER_API_KEY`. `PG_AI_API_KEY` stays
the `established` key. Each key has its own daily and monthly spend limit at
the upstream (on the Gateway, a daily budget per key under the team's monthly
one). A sybil attack with new accounts spends the `newcomer` key's limit and
stops there.

Without `PG_AI_NEWCOMER_API_KEY`, newcomers spend through `PG_AI_API_KEY` and
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
  plus `max_completion_tokens` output tokens, at the configured prices.
- **Settle**: one statement, `reserved = reserved - $r, spent = spent + $charge`,
  with `$charge` from the spec's requirement "A turn is charged what it cost":
  the `usage.cost` the upstream reported, in USD, or, when the usage carries
  no cost, its token counts at the configured prices.
  It runs after the response has ended, so it adds no latency either. Only a
  stream read to its end with the caller still connected is charged its
  reported usage: usage seen on a turn that stopped early may be a running
  total, and a caller that hangs up before the upstream answers may already
  have been billed for, so both are charged the reservation.
- A function that dies between reserve and settle leaves the reservation in
  `reserved` for the rest of the UTC day. The user is overcharged, which the
  Non-Goals allow.

The route asks the upstream for usage on the stream
(`stream_options: { include_usage: true }`), reads the SSE events while piping
them, and takes the last `usage` object. Nous sends it in a final event with
empty `choices`, every earlier event carrying `usage: null`, and it carries the
turn's cost. Checked on 2026-11-10 with `z-ai/glm-5.3-flash:US`:

```json
"usage": { "prompt_tokens": 18, "completion_tokens": 6, "cost": 0.000009405,
  "cost_details": { "source": "gateway_computed_spend", ... } }
```

18 × $0.2475/M + 6 × $0.825/M is exactly $0.000009405, the catalogue price.
Charging `usage.cost` counts cached input at its lower price and follows a
price change with no variable to update. Prices still come from configuration
(`PG_AI_PRICE_INPUT`, `PG_AI_PRICE_OUTPUT`, per million tokens): they size the
reservation, and they charge a turn whose usage has no cost.

Alternative: Upstash Redis. Lower latency per call, but a second store to
provision and operate. Postgres already serves `readSession` on every turn.

### 5. Request bounds

- `PG_AI_MAX_BODY_BYTES`: a body over the limit is refused with 413 before
  `readJson` buffers it, using `content-length` and the byte count while
  reading.
- `PG_AI_MAX_OUTPUT_TOKENS`: sent as `max_completion_tokens` on every upstream
  request, to the Gateway and Nous alike: both take it, and Nous refuses
  `max_tokens` for GLM. `FORWARDED` already drops a caller's `max_tokens` and
  `max_completion_tokens`.

### 6. Refusal shapes

The route keeps the shape it already uses for `signed-out`: a status, an
`error` sentence, and a `reason` the panel matches on. A `daily-cap` or
`pool-exhausted` refusal also carries the caller's `tier`, which the panel
passes to `agent_refused`. The tier is the caller's own, so it tells the
caller nothing about anyone else.

| Situation | Status | `reason` | `Retry-After` |
| --- | --- | --- | --- |
| Daily cap reached | 429 | `daily-cap` | seconds to 00:00 UTC |
| Upstream `402` (key limit, empty balance, any other) | 503 | `pool-exhausted` | the upstream's, when it sent one |
| Body over the limit | 413 | none | none |
| Ledger unavailable | 503 | none | none |

The user's cap resets at 00:00 UTC. A Nous key's daily limit resets on its own
rolling window, so the route cannot compute when a tier's pool reopens and
passes on the upstream's `Retry-After` instead; with none, it sends none, and
the panel's sentence names no time.

Every upstream `402` is `pool-exhausted`: whatever the code, the turn cannot be
paid for, and the user's answer is the same. The code decides only what the
maintainers hear:

- `key_spend_limit_reached` (Gateway: `quota_for_entity_exceeded`): a tier's
  limit, expected; logged as a warning.
- `insufficient_credits_for_paid_model` (Gateway: `insufficient_funds`): the
  balance is empty and every tier is off until a person adds credits;
  reported to Sentry as an error.
- Any other `402`: reported to Sentry with its redacted body, so an
  unknown code gets a branch of its own.

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

- [Nous is down] → turns fail until it recovers. The Gateway fallback is a
  change of variables, with no deploy of code.
- [The prepaid balance runs out] → no auto top-up, so every tier is refused
  with `pool-exhausted` until a person adds credits. The Sentry error on
  `insufficient_credits_for_paid_model` is the signal; a named person owns
  topping up (task 4.3).
- [Nous's data retention and training terms] → unverified. The Gateway path
  chose zero-retention providers explicitly; on Nous the `:US` id fixes the
  region only.
- [On the Gateway fallback, both allowed providers fail at once] → turns fail
  until one recovers. Baseten showed 99.10% and Fireworks 99.90% uptime over
  the day before 2026-10-29. Adding a provider to `PG_AI_PROVIDERS` needs no
  deploy, only a check that it is US-region with zero data retention, from the
  Gateway's endpoint list (`/v1/models/zai/glm-5.3-flash/endpoints`).
- [Shared office or VPN IPs] → unchanged by this design. Per-user caps key on
  `user.id`, not the IP.
- [Sybil accounts older than the configured age] → bought aged accounts reach
  the `established` pool. The `established` key's daily limit bounds the
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
2. A person creates the two Nous keys with their daily and monthly limits and
   sets `PG_AI_API_KEY`, `PG_AI_NEWCOMER_API_KEY` and the limit variables in
   Vercel. `PG_AI_BASE_URL` and `PG_AI_MODEL` stay unset, on the Nous
   defaults.
3. Merge. With the new variables absent the route uses defaults, so the order
   of steps 2 and 3 does not matter for availability.

Rollback: revert the merge. The upstream does not change, so no key moves.

Moving to the Gateway later follows "Fallback: Vercel AI Gateway" and the
Gateway section of `client-v2/docs/deploy-client-vercel.md`.

## Starting values

Derived from the Nous price for `z-ai/glm-5.3-flash:US` on 2026-11-10: $0.2475
per million input tokens, $0.825 per million output tokens. The charge is the
reported `usage.cost`, so the prices only size the reservation and charge a
turn whose usage has no cost. They sit above the Gateway's list price ($0.15 /
$0.50), so on the fallback they overcharge, as the Non-Goals allow. The code
takes each value from the environment, with these as the defaults. Read
`agent_refused` after a week and adjust.

| Setting | Value | Reason |
| --- | --- | --- |
| `PG_AI_PRICE_INPUT` | 0.2475 (USD per million) | Nous price |
| `PG_AI_PRICE_OUTPUT` | 0.825 (USD per million) | Nous price |
| `PG_AI_MAX_BODY_BYTES` | 524288 (512 KB) | About 128k input tokens at 4 bytes per token |
| `PG_AI_MAX_OUTPUT_TOKENS` | 8192 | Room for a long answer with `low` reasoning |
| `PG_AI_PROVIDERS` | `baseten,fireworks` on the Gateway, none elsewhere | The US-region, zero-data-retention endpoints (decision 1, fallback) |
| Newcomer account age | under 30 days | A month of account history before the larger cap |
| `newcomer` daily cap per user | $0.10 | About 13 typical steps |
| `established` daily cap per user | $0.50 | About 67 typical steps |
| `newcomer` key daily limit (Nous) | $10 | 100 newcomers at their cap |
| `established` key daily limit (Nous) | $50 | 100 established users at their cap |
| `newcomer` key monthly limit (Nous) | $250 | The daily limit for 25 days |
| `established` key monthly limit (Nous) | $1,250 | The daily limit for 25 days |

How the numbers follow from the price:

- **Worst-case turn:** 128k input tokens ($0.0317) plus 8192 output tokens
  ($0.0068), about $0.038. That amount is the reservation for a body at the
  limit.
- **Typical step:** about 25k input and 1.5k output tokens, about $0.0074.
  This is an estimate of the panel's prompt, tools and history, not a
  measurement. `agent_refused` and the reported costs replace it.
- **Sybil cost:** a newcomer account yields at most $0.10 a day, and all
  newcomers together at most $10 a day. Reaching the `established` pool needs
  accounts older than 30 days, and that pool is bounded at $50 a day.
- **Worst month:** $1,500, the two monthly key limits, and never more than the
  prepaid balance.

## Open Questions

- Whether a Nous key limit is soft, letting the turn that crosses it complete,
  as a Gateway budget does. Either way the overshoot is the turns in flight
  when the limit is reached, each at most the worst-case turn.
- The exact body of an empty-balance `402` on the inference API. The Nous
  Portal documents `insufficient_credits_for_paid_model`; until one is seen,
  any other `402` is still `pool-exhausted` and reported (decision 6).
- On the Gateway fallback, whether its streamed `usage.cost` matches
  `total_cost` from `GET /v1/generation?id=...`. A local run on 2026-10-29
  against a free-tier model saw `cost`, `market_cost` and `cost_details`, all
  0; the field is undocumented. Check one paid turn before moving to the
  Gateway; until then the price variables are the fallback charge there too.
