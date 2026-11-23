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
   bytes: 32 MiB}`, `CHAT_LIMIT_ORDER`, `NO_PROJECT_REASON`,
   `readChatLimitExceeded(body)` (client side, checks every field).
3. **`model/conversations.mjs`**:
   - `appendMessagesWith(limits)(userId, thread, items)`, with
     `appendMessages` bound to `CHAT_LIMITS`: after `begin`, take
     `pg_advisory_xact_lock(hashtextextended('conversations-cap:' || user))`
     in a statement of its own, measure, write, measure again, throw
     `OverChatLimit` for the first measure above its cap that grew.
   - `ensureThread`: `select deleted_at from projects ... for share`, no
     insert; no row throws `NoProject`.
   - Tests (`model/conversation-caps.test.mjs`, DB-backed, skip without
     `DATABASE_URL`): unknown project (no rows created), each cap with small
     injected limits (refused, earlier data kept), re-push at the cap passes,
     a happy path.
4. **Route**: `describeFailure` maps `NoProject` to 409 `no-project` and
   `OverChatLimit` to 413 with the limit. Tests in `api/conversations.test.mjs`.

## Client

5. **`chat-sync.ts`**: `_post` reads a 409 `no-project` into `"no-project"`
   (no failure report) and a 413 with a chat-limit body into `"over-limit"`;
   `PgChatSync.limit()` + `onDidChangeLimit`, kept per thread so a push that
   grew nothing does not hide another thread's refusal; a `"pushed"` clears
   that thread's. Threads refused for `no-project` are kept per project and
   listed by `PgChatSync.awaiting(projectId)`. `forgetAccountState()` clears
   both on an account change. In-source tests first.
6. **Re-push**: `PgProjectSync.onDidAccept(projectId)` fired where a push's
   mark is written; the chat-thread effect subscribes and calls `pushThread`
   for each of `awaiting(projectId)`. `pushThread` maps both new outcomes to
   "still owed". Sign-out flushes the current project before handing the
   conversations over, so a new project's row exists first.
7. **Panel**: a callout above the composer from `chatSyncLimit()` (through
   `features/persistence/index.ts`), shown only while signed in, wording in
   `chatLimitText` with a component test.

## Gate

`yarn run check` (includes `yarn test-api` against the compose Postgres),
`sx:review-pr full` + default, testing plan cases by blast radius.
