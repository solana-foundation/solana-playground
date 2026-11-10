# Tasks

Each task is one small PR. Tick a task in the PR that lands it. Groups 1 and 3
may run at the same time. Group 2 follows group 1. Group 4 follows groups 2
and 3.

Group 3 edits the assistant's error handling. `#47` (HOO-1754) moves that
code to `@/shared/lib/ai`; land group 3 on whichever side of `#47` is
current when it starts, and apply the same mapping there.

## 1. Schema and configuration

- [x] 1.1 Migration in `client-v2/db/migrations`: table `agent_spend`
      (`user_id`, `day`, `reserved`, `spent`, primary key `(user_id, day)`,
      foreign key to `"user"`) and nullable `"user"."githubCreatedAt"`.
      Regenerate `db/schema.sql` with `yarn db-dump`. Verify with
      `yarn db-migrate` then `yarn db-status` showing it applied (HOO-1751)
- [x] 1.2 `agentEnv` in `src/shared/config/server-env.mjs` reads
      `PG_AI_NEWCOMER_API_KEY`, `PG_AI_PROVIDERS` (a comma-separated list,
      empty for none), `PG_AI_PRICE_INPUT`, `PG_AI_PRICE_OUTPUT`,
      `PG_AI_MAX_BODY_BYTES`, `PG_AI_MAX_OUTPUT_TOKENS`, and the tier caps and
      newcomer age, with the defaults in the design's "Starting values".
      Verify with a unit test of each default and of an empty variable
      reading as unset (HOO-1751; independent of 1.1)
- [x] 1.3 `src/features/auth/model/auth.mjs`: declare `githubCreatedAt` in
      `user.additionalFields` (`type: "date"`, `required: false`,
      `input: true`, with `/update-user` in `disabledPaths`; design decision
      3 says why) and copy the profile's `created_at` in
      `mapProfileToUser` next to `login`. Record in the design whether Better
      Auth runs `mapProfileToUser` on every sign-in or only on create. Verify
      with a case in `src/features/auth/model/auth.test.mjs` that the mapped
      date survives Better Auth's parsing, and by signing in locally and
      reading the column (HOO-1751; after 1.1)

## 2. The gate on `/api/agent`

Run 2.1, 2.2 and 2.3 at the same time; 2.4 follows all three.

- [x] 2.1 `features/agent/server/account-age.mjs`: read GitHub's
      `GET /user` with the user's `github` account `accessToken`, store
      `created_at` in `"user"."githubCreatedAt"`, and store nothing on a
      failed or timed-out read. Verify with `yarn test-api` cases for a stored
      date, a refused read and a timed-out read, using a stubbed `fetch`
      (HOO-1751; after 1.1)
- [x] 2.2 `features/agent/server/ledger.mjs`: `reserve` as the single
      statement of design decision 4, returning `tier`, whether the date is
      stored, and whether the turn was admitted, also when it is refused;
      `settle` as one statement with the charge rules of "A turn is charged
      what it cost"; and the UTC day boundary with seconds to the next reset.
      Verify with `yarn test-api` cases against Postgres (skipped without
      `DATABASE_URL`): a reserve at the cap is refused and still returns the
      tier, a single turn costing more than the cap is refused on an empty
      day, two parallel reserves at the edge admit one, a settle replaces the
      reservation, the cap starts again on the next UTC day, a missing date is
      `newcomer`, an old date is `established`, and a pool spy counts one query
      for `reserve` and one for `settle` (HOO-1751; after 1.1)
- [x] 2.3 `features/agent/server/bounds.mjs`: refuse a body over
      `PG_AI_MAX_BODY_BYTES` with 413 from `content-length` and while
      reading, and estimate a turn's worst-case cost from the body size,
      `PG_AI_MAX_OUTPUT_TOKENS` and the prices. Verify with `yarn test-api`
      cases for a body just under and just over the limit, and a chunked body
      with no `content-length` (HOO-1751)
- [x] 2.4 Wire the gate into `api/agent.mjs`: the tier `reserve` returns
      picks the upstream key; reserve before the upstream call and refuse
      with 429 `daily-cap` plus `tier` and `Retry-After`; send `max_completion_tokens`,
      `stream_options.include_usage`, and
      `providerOptions.gateway.only` from `PG_AI_PROVIDERS` when it is
      non-empty; read `usage` from the stream while
      `pipeStream` forwards it, and settle at the end, on abort and on a
      broken stream, after the response has ended; when `reserve` reported no
      stored date, run 2.1's lookup after that, before the handler returns;
      map a `402` `quota_for_entity_exceeded` or `insufficient_funds` to
      503 `pool-exhausted` plus
      `tier` and `Retry-After` without a charge; answer 503 when the ledger
      fails, before any upstream call. First check whether the Gateway's
      streamed `usage` carries a cost and record the answer in `design.md`;
      if it does, charge it and drop the price variables. Verify with the
      scenarios of requirements "A user's daily spend is capped" to "The gate
      fails closed" as cases in `src/features/agent/agent.integration.spec.ts`,
      including the parallel-turn and abandoned-turn cases, the scenarios of
      "The account age is learned after a turn", and a count of the queries
      one turn issues before and after the upstream call (HOO-1751; after
      2.1, 2.2, 2.3)
- [x] 2.5 Nous refusals in `api/agent.mjs`: every upstream `402` is 503
      `pool-exhausted` with `tier`, carrying the upstream's `Retry-After`
      when it sent one and none otherwise; `key_spend_limit_reached` and
      `quota_for_entity_exceeded` log a warning,
      `insufficient_credits_for_paid_model` and `insufficient_funds` report
      an error to Sentry, any other `402` reports its redacted body (design
      decision 6). Verify with the scenarios of "An exhausted pool is
      reported as such" as cases in
      `src/features/agent/agent.integration.spec.ts`, the Sentry report read
      from the logger (HOO-1751; may run with 2.6)
- [x] 2.6 Charge the reported cost: `settle` charges the larger of
      `usage.cost` (USD, a finite number not below zero) and the token
      counts at the prices, or the one of the two the usage allows; the price defaults in `agentEnv` become 0.2475 and 0.825.
      Verify with the scenarios of "A turn is charged what it cost" in
      `agent.integration.spec.ts`, a `yarn test-api` case for the charge
      with and without `cost`, and the `agentEnv` default tests (HOO-1751;
      may run with 2.5)

## 3. The panel and its event

- [x] 3.1 `features/agent` gains `index.ts`, `model/telemetry.ts` with
      `agentTelemetry` and the event `agent_refused` (TSDoc on the key), and
      the prefix `agent` in `src/shared/lib/telemetry/prefixes.ts`. Verify
      that the slice-structure test and the prefix uniqueness test pass
      (ticket to file)
- [x] 3.2 The default backend's error handling in the assistant panel reads
      `reason` and `tier` of a `daily-cap` or `pool-exhausted` refusal from
      our own backend only (`backendRefusal`, which also reads `signed-out`),
      shows the two sentences of "The panel says why the default backend
      stopped", keeps the conversation and the picker, and tracks
      `agent_refused` once through `agentTelemetry`. Verify with unit tests
      next to the mapping that read the event from the memory provider for
      `daily-cap`, `pool-exhausted`, a missing `tier` (`unknown`) and a
      `signed-out` refusal (no event), and that a refusal from another
      backend URL shows the raw status (HOO-1751; after 3.1)
- [x] 3.3 Browser test in `client-v2/e2e/` for the two refusals: the chat
      shows the sentence, the earlier messages stay, and `Message the
      assistant` still works after switching to a key-based backend. Verify
      with `yarn test-e2e` for that file (HOO-1751; after 3.2)
- [x] 3.4 The `pool-exhausted` sentence names no time: "The free assistant
      is out of capacity for now. Try again later, or bring your own key to
      keep going." Update `docs/assistant-context.md` to match (then
      `yarn sync-assistant-context`). Verify with the mapping's unit tests
      and the browser test of 3.3 (HOO-1751)
- [x] 3.5 The status's AI indicator after a `pool-exhausted` refusal:
      `PgAssistant.markLimitReached` takes the refusal's reason, a spent pool
      holds Limit reached with no time until a turn goes through, and its
      panel shows the chat's sentence with "add a key of your own". Verify
      with the store's and `widgets/status` unit tests and the browser test
      `client-v2-status: The free pool is spent` (HOO-1751; after 3.4)

## 4. Operations and documentation

- [x] 4.1 Document the Gateway setup in
      `client-v2/docs/deploy-client-vercel.md`: the two keys, their daily
      budgets, the team's monthly budget, the new variables, the order of
      "migrate first, then merge to `master`", and how to read `agent_refused`
      and the Gateway logs after a week. Verify that each variable the page
      names is read by `agentEnv` (HOO-1751; after 2.4)
- [x] 4.2 Update `docs/assistant-context.md` (then
      `yarn sync-assistant-context`) with the daily allowance and what the
      panel says at the limit, and update the comment at the top of
      `api/agent.mjs` and the Firewall page's `Rate limit /api/agent (IP)`
      description, which both say per-user caps are future work. Verify with
      `yarn run check` in `client-v2/` (HOO-1751; after 2.4)
- [x] 4.6 `client-v2/docs/deploy-client-vercel.md`: the Nous setup becomes
      the primary one (two keys, each with a daily and a monthly spend
      limit, the prepaid balance with no auto top-up and who tops it up, the
      Sentry error that says it is empty, the price defaults), and the
      Gateway setup moves under a fallback heading. Verify that each variable
      the page names is read by `agentEnv` (HOO-1751; after 2.5, 2.6)
- [ ] 4.3 A person sets up the Nous keys (no agent handles the keys):
      creates the `established` and `newcomer` keys with the daily and
      monthly limits of the design's "Starting values", sets
      `PG_AI_API_KEY` and `PG_AI_NEWCOMER_API_KEY` in Vercel, names who tops
      up the balance, and gets sign-off on the $1,500 monthly total. Verify
      in the Nous dashboard that both keys show their limits (HOO-1751;
      after 2.5)
- [ ] 4.4 On a preview with the Nous keys: send turns until a `newcomer`
      account reaches its cap, check the 429 and the panel sentence, and
      check that the `newcomer` key's spend in the Nous dashboard matches the
      sum of the turns' reported `usage.cost`. Verify by recording the result
      in the PR (HOO-1751; after 3.4, 4.3)

## Workflow follow-up

- Archive the change after the PRs for groups 1 to 4 have merged and a
  person asked for it in the session.
- Kora paymaster deploys (HOO-1787) reuse the tier and the `user.id` limit
  key and get their own change once the Kora team answers how the deployer
  identifies a user.
