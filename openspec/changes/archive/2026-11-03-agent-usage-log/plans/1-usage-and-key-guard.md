# Agent usage log and key guard: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Record one `agent_turn` row per `/api/agent` turn that reaches the ledger, and make sure no hosted key leaves the route in a response or a log.

**Architecture:** `settle` (ledger) becomes one CTE that updates `agent_spend` and inserts into `agent_turn`. `recordCapped` inserts the row for a cap refusal. `redactSecrets` lives in `features/agent/server/redact.mjs` and wraps every upstream-derived string in `api/agent.mjs`.

**Tech Stack:** Node ESM (`.mjs`), Postgres via `query`, `node --test` (`yarn test-api`), vitest for `agent.integration.spec.ts`.

> **Superseded in part by review (2026-11-03).** Where this plan and
> `design.md` differ, `design.md` and the spec hold: a cap refusal adds one to
> `agent_spend.capped` and writes no `agent_turn` row, so there is no `capped`
> outcome; `agent_turn` carries the reserve's `day`; `settle` takes
> `{ userId, day, reserved, charge, tier, end }` and `recordCapped` takes
> `{ userId, day }`; upstream error text is cut to 300 characters before it is
> redacted; `pipeStream` logs an upstream failure and a relay failure apart
> (task 2.3); and the doc section is "Rotating the keys".

**Spec:** `openspec/changes/agent-usage-log/specs/assistant-default-backend-usage/spec.md`, `design.md`.

## Global Constraints

- Outcome values: `completed`, `unfinished`, `refused`, `abandoned`, `capped`.
- Redaction threshold: every run of **8** or more consecutive characters of a key, replaced by `[redacted]`.
- Keys covered: `AGENT_API_KEY` and `AGENT_NEWCOMER_API_KEY` (whichever are set).
- `settle` stays one query; the integration spec's round-trip count must not change.

## Review Focus

- A key shorter than 8 characters (a test or misconfigured key): redact the whole key anyway. Test in Task 3.
- Newcomer key unset: `keys.newcomer === keys.established`. Redaction must not double-process or break. Covered by the same unit test.
- A settle on a day row that does not exist (should never happen): the CTE still inserts the turn row. Test in Task 1.
- `recordCapped` failing must not change the 429 the caller already got. Test in Task 2 (db down after reserve).
- Text containing regex metacharacters from a key (`+`, `/`): use string search, never a RegExp built from the key. Test in Task 3.

---

### Task 1: Migration and ledger statements

**Files:** Create `client-v2/db/migrations/20261102190000_agent_turn.sql`; modify `client-v2/db/schema.sql` (`yarn db-dump`), `client-v2/src/features/agent/server/ledger.mjs`, `client-v2/src/features/agent/server.mjs` (export), test `ledger.test.mjs`.

**Interfaces (produces):**
- `settle(query, { userId, day, reserved, charge, tier, outcome, usage })`, where `usage` is `{prompt_tokens?, completion_tokens?} | null`
- `recordCapped(query, { userId, tier })`

- [ ] Write migration: `agent_turn(id bigserial pk, user_id text not null references "user"(id) on delete cascade, at timestamptz not null default now(), tier text not null, outcome text not null check (outcome in (...)), prompt_tokens integer, completion_tokens integer, charged bigint not null default 0 check (charged >= 0))`, index `agent_turn_user_at (user_id, at)`. Down drops it.
- [ ] `yarn db-migrate && yarn db-status && yarn db-dump`
- [ ] Failing tests in `ledger.test.mjs`: "settle records the turn" (row with outcome, tokens, charged = spent delta), "settle records the turn even without a day row", "recordCapped writes a capped row with charged 0 and null tokens".
- [ ] Implement; run `yarn test-api` → pass.
- [ ] Commit `feat(client-v2): record each default-backend turn in agent_turn (HOO-2396)`.

### Task 2: Route wiring

**Files:** modify `client-v2/api/agent.mjs`, `client-v2/src/features/agent/agent.integration.spec.ts` (fake: `update agent_spend` statement also records into `state.turns`; `insert into agent_turn` alone records a capped row).

- [ ] Failing cases: completed turn → one `completed` turn with tokens; capped turn → one `capped` turn and no upstream call; query count per turn unchanged for admitted turns; db failing on `recordCapped` still answers 429.
- [ ] Implement: in the handler's `finally`, admitted → `settle` with `tier: gate.tier, outcome: end.kind, usage: end.kind === "completed" ? end.usage : null`; not admitted → `recordCapped(...).catch(log)`.
- [ ] `yarn vitest run src/features/agent` → pass. Commit.

### Task 3: Redaction

**Files:** create `client-v2/src/features/agent/server/redact.mjs` and `redact.test.mjs`; export it from `server.mjs`; modify `api/agent.mjs`; cases in the integration spec.

**Interfaces (produces):** `redactSecrets(text: string, secrets: (string|undefined)[]) => string`

- [ ] Unit tests: exact key removed; a 10-character inner run removed; a 7-character run kept; a key with `+/` handled; a key shorter than 8 removed whole; undefined secrets ignored.
- [ ] Implement it with longest-first windows over each key, using `split/join` (no RegExp).
- [ ] Integration cases, with `console.error/warn` spied: upstream 500 body quoting the key, a 401 body quoting it, a 402 non-Gateway body quoting it, fetch throwing `new Error("bad " + key)`, and a stream erroring with the key. Assert that no response body or console argument (JSON-stringified) contains the key or its first 8 characters.
- [ ] Apply `redact` (a closure over `configured.keys`) at: the passthrough `Upstream ${status}`, the 401/403 log `body`, the 402 log `body`, `Upstream unreachable: ${e.message}`, the `pipeStream` error frame (pass a redactor in).
- [ ] Run → pass. Commit `fix(client-v2): redact the hosted keys from every upstream error the agent route relays or logs (HOO-2396)`.

### Task 4: Docs and the check

- [ ] `docs/deploy-client-vercel.md`: a "Rotating the AI keys" section (create a new Gateway key, set it in Vercel for Production and Preview, redeploy, check one turn, revoke the old one; the newcomer key the same way). Also a line that `agent_turn` is read for the usage (sample SQL for per-account turns per hour).
- [ ] `yarn run check` in `client-v2/`.
- [ ] Post the key-protection check as a comment on HOO-2396.
