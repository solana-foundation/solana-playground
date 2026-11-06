# Proposal

## Why

Deleting a project already hides its assistant conversations: the server marks
the project and its threads deleted, and no device can read them back. The
messages themselves stay in the database for good, so "deleted" means hidden,
not erased. A signed-in user who deletes a project expects its chat history to
be gone from the account (HOO-1738), and the confirmation dialog does not
mention the chat at all.

## What Changes

- Deleting a project on the server erases the messages of every conversation
  under it and clears each conversation's title. The conversation rows stay as
  tombstones, so a device that still holds the thread is told it was deleted
  (410, scope `project` or `thread`) rather than that it never existed.
- A one-time data migration erases the messages and titles of conversations
  that were already tombstoned before this change, so projects deleted earlier
  are covered too.
- The delete-workspace confirmation dialog says the project's assistant chat is
  deleted with it, from the account as well when the user is signed in.
- Telemetry: none added, renamed or removed. The change touches the
  `persistence` slice's server module only; the dialog lives in a legacy root.

## Capabilities

### New Capabilities

- `project-deletion`: what deleting a project removes, on the device and in
  the account, and what the user is told before confirming.

### Modified Capabilities

None.

## Impact

- `client-v2/src/features/persistence/model/projects.mjs` (`deleteProject`),
  reached from `DELETE /api/projects`; its tests run under `yarn test-api`.
- A new migration in `client-v2/db/migrations` and the regenerated
  `db/schema.sql`. User-visible consequence: chat history of projects deleted
  before this change is erased from the account when the migration is applied.
- `client-v2/src/views/sidebar/explorer/Component/Modals/DeleteWorkspace.tsx`:
  one line of copy.
- Out of scope: the client's delete flow (`settleLocalDeletes` already calls
  `DELETE /api/projects` and forgets the local thread through
  `PgThreadIndex`); deleting a single conversation without its project;
  erasing the project and conversation tombstone rows themselves; deleting the
  whole account.
