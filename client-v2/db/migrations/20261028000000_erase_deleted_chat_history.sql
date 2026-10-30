-- Erase what deleted conversations said.
--
-- Deleting a project tombstoned its conversations but left their messages and
-- titles in place, unreadable through every API yet kept forever.
-- `deleteProject` erases them in its own transaction; this one-off backfill
-- clears every conversation tombstoned before it did, however it came to be
-- tombstoned. The rows stay: a restarted tutorial's old thread is refused by
-- its own tombstone (`ensureThread`).

-- migrate:up

delete from messages m
 using conversations c
 where m.conversation_id = c.id
   and c.deleted_at is not null;

update conversations
   set title = null
 where deleted_at is not null
   and title is not null;

-- migrate:down

-- Nothing: erased content cannot be restored.
