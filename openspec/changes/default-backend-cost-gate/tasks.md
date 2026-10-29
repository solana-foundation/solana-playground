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
      `AGENT_NEWCOMER_API_KEY`, `AGENT_PROVIDERS` (a comma-separated list,
      empty for none), `AGENT_PRICE_INPUT`, `AGENT_PRICE_OUTPUT`,
      `AGENT_MAX_BODY_BYTES`, `AGENT_MAX_OUTPUT_TOKENS`, and the tier caps and
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
      `AGENT_MAX_BODY_BYTES` with 413 from `content-length` and while
      reading, and estimate a turn's worst-case cost from the body size,
      `AGENT_MAX_OUTPUT_TOKENS` and the prices. Verify with `yarn test-api`
      cases for a body just under and just over the limit, and a chunked body
      with no `content-length` (HOO-1751)
- [x] 2.4 Wire the gate into `api/agent.mjs`: the tier `reserve` returns
      picks the upstream key; reserve before the upstream call and refuse
      with 429 `daily-cap` plus `tier` and `Retry-After`; send `max_tokens`,
      `stream_options.include_usage`, and
      `providerOptions.gateway.only` from `AGENT_PROVIDERS` when it is
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
- [ ] 4.3 A person sets up the Gateway for the first time (no agent handles
      the keys): buys credits, so the team is on the paid tier; turns on auto
      top-up; registers no provider credential (Gateway BYOK), so budgets
      count every request; creates the two Gateway keys and their daily
      budgets and the team's monthly budget; sets the variables in Vercel;
      and gets sign-off on the $1,500 monthly team budget. Verify in the
      Gateway dashboard that both keys show their budgets and the team shows
      no BYOK credential (HOO-1751; after 2.4)
- [ ] 4.5 A day after production traffic moves to the Gateway, a person
      revokes the Nous Research key. Verify that the Gateway logs show the
      day's turns and that the Nous Research dashboard shows the key revoked
      (HOO-1751; after 4.4)
- [ ] 4.4 On a preview with the Gateway keys: send turns until a
      `newcomer` account reaches its cap, check the 429 and the panel
      sentence, and check one Gateway log entry per turn under the right key.
      For one turn, compare the stream's final `usage.cost` with
      `total_cost` from `GET /v1/generation?id=...` (design, Open
      Questions). Verify by recording the result in the PR (HOO-1751; after
      3.3, 4.3)

## Workflow follow-up

- Archive the change after the PRs for groups 1 to 4 have merged and a
  person asked for it in the session.
- Kora paymaster deploys (HOO-1787) reuse the tier and the `user.id` limit
  key and get their own change once the Kora team answers how the deployer
  identifies a user.
