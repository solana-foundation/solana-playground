# Design

## Context

`deleteProject` (`features/persistence/model/projects.mjs`) runs one
transaction: tombstone the `projects` row, delete its `project_files`, and set
`deleted_at` on its `conversations`. `messages` reference `conversations` by
foreign key and are never touched. `appendMessages` reads the tombstones to
answer a push with `ThreadDeleted` (410, scope `project` or `thread`), and
`chat-sync` on the client drops its copy of a thread on exactly that answer.

## Goals / Non-Goals

**Goals:** no message content and no title survive a project delete; the 410
contract for a deleted thread is unchanged.

**Non-Goals:** erasing tombstone rows; a retention window or delayed purge; a
per-conversation delete.

## Decisions

- **Delete `messages`, keep the `conversations` row.** The row is what turns a
  late push into a 410 instead of a fresh thread. While the project stays
  deleted its own tombstone would refuse the push anyway, but a tutorial's id
  is derived from its name: once the tutorial is started again the project row
  is live, and only the conversation's tombstone (scope `thread`) stops a
  device that was offline during the delete from recreating the old run's
  thread inside the new one. The row keeps only ids, owner and timestamps.
- **Clear `title` with the messages.** It is derived from the conversation's
  content, so it is history too.
- **Same transaction as the tombstone.** A delete that tombstoned but failed to
  erase would leave the state this change exists to remove; one transaction
  makes the two land together.
- **Erase every conversation under the project, including ones tombstoned
  earlier.** A tutorial restarted after a delete leaves the earlier run's thread
  tombstoned under a live project id; the next delete of that project erases it
  too, rather than filtering on `deleted_at is null`.
- **A data migration for earlier deletes**, rather than code that purges
  lazily. The set is bounded and known now; a migration runs once and is
  visible in `schema_migrations`. It deletes messages of conversations whose
  `deleted_at` is set and nulls their titles; its `down` is a no-op, since
  erased content cannot come back.
- **Copy, not a new dialog.** The dialog is in a legacy root and is not
  designed anew; one `Desc` line is the UI move rule's "fix in place".

## Risks / Trade-offs

- [The purge is irreversible] → It runs only on rows that are already
  unreadable through every API; nothing a user can see changes.
- [A large account makes the delete transaction longer] → Messages are indexed
  by `conversation_id`; one delete per project is bounded by its history.

## Migration Plan

Apply with `yarn db-migrate` as usual. No rollback restores data; rolling back
the code alone is safe, since the old code reads the same tombstones.
