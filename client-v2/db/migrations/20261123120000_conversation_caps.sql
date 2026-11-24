-- What one account stores in conversations, measurable on every push
-- (HOO-2882). `appendMessages` counts the account's live conversations, their
-- messages and the bytes of those messages before and after each push, and
-- refuses one that takes a measure past `CHAT_LIMITS`
-- (`features/persistence/model/chat-limits.mjs`).
--
-- `bytes` is stored rather than computed in the measure: the payload is
-- TOASTed, and summing `octet_length(payload::text)` would read every
-- transcript the account holds on every turn. With the column in the index
-- below, the sum is an index-only scan of the account's message keys.
-- `payload::text` is what the route was sent, re-serialised by Postgres, so
-- it is the size the account actually costs the database, not the client's
-- spelling of it.

-- migrate:up

alter table messages
  add column bytes integer
    generated always as (octet_length(payload::text)) stored;

create index messages_bytes_idx on messages (conversation_id) include (bytes);

-- The measure's other half: the account's live conversations.
-- `conversations_project_idx` is partial on `project_id is not null`, so it
-- does not serve a count over every live thread of a user.
create index conversations_user_live_idx on conversations (user_id)
  where deleted_at is null;

-- migrate:down

drop index conversations_user_live_idx;
drop index messages_bytes_idx;
alter table messages drop column bytes;
