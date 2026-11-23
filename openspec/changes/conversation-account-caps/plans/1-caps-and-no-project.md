# Plan: conversation caps per account, no project row from a push (HOO-2882)

Goal: tasks 1.1-2.3 of `conversation-account-caps`, one PR into foundation
`master`. Executed inline, test first.

## Server

1. **Migration** `db/migrations/20261123120000_conversation_caps.sql`:
   `alter table messages add column bytes integer generated always as
   (octet_length(payload::text)) stored`, and
   `create index messages_bytes_idx on messages (conversation_id) include (bytes)`
   so the measure is an index-only scan. `yarn db-migrate`, `yarn db-dump`.
2. **`model/chat-limits.mjs`**: `CHAT_LIMITS = {threads: 200, messages: 20000,
   bytes: 32 MiB}`, `CHAT_LIMIT_REASONS`, `chatLimitExceeded(reason, count)`,
   `readChatLimitExceeded(body)` (client side, checks every field).
3. **`model/conversations.mjs`**:
   - `appendMessages(userId, thread, items, {limits})`: after `begin`, take
     `pg_advisory_xact_lock(hashtextextended('conversations-cap:' || user))`
     in a statement of its own, measure, write, measure again, throw
     `OverChatLimit` for the first measure above its cap that grew.
   - `ensureThread`: `select deleted_at from projects ... for share`, no
     insert; no row throws `NoProject`.
   - Tests (`model/conversations.test.mjs`, DB-backed, skip without
     `DATABASE_URL`): unknown project (no rows created), each cap with small
     injected limits (refused, earlier data kept), re-push at the cap passes,
     a happy path.
4. **Route**: `describeFailure` maps `NoProject` to 409 `no-project` and
   `OverChatLimit` to 413 with the limit. Tests in `api/conversations.test.mjs`.

## Client

5. **`chat-sync.ts`**: `_post` reads a 409 `no-project` into `"no-project"`
   (no failure report) and a 413 with a chat-limit body into `"over-limit"`;
   `PgChatSync.limit()` + `onDidChangeLimit`; a `"pushed"` clears it.
   Threads refused for `no-project` are kept per project;
   `PgChatSync.pushAwaiting(projectId)` pushes them. In-source tests first.
6. **Re-push**: `PgProjectSync.onDidAccept(projectId)` fired where a push's
   mark is written; the chat-thread effect subscribes and calls
   `pushAwaiting`. `pushThread` maps both new outcomes to "still owed".
7. **Panel**: a line under the thread from `PgChatSync.limit()`, wording in
   one function with a unit test.

## Gate

`yarn run check` (includes `yarn test-api` against the compose Postgres),
`sx:review-pr full` + default, testing plan cases by blast radius.
