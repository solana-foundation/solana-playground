# Proposal

## Why

A session that ends without a sign-out keeps its chat threads and its running
assistant turn on the device, on purpose: the same account signing in again
picks up where it stopped. When a different account signs in next, its
sign-in uploads every local thread into that account, the first account's
included, and the first account's turn keeps writing into its thread. One
account's conversations reach another account's history
([HOO-2757](https://linear.app/solana-fndn/issue/HOO-2757), the Greptile P1
thread on solana-foundation/solana-playground#116). Projects do not leak this
way, because their sync marks are kept per account. Chat threads have no owner
on the device.

## What Changes

- The device records which account its chat threads belong to: the account
  that last signed in on it, until a sign-out hands every thread over.
- On a sign-in by another account, before that account's adoption and upload
  of the local threads, the assistant's running turn stops, its thread closes,
  and the recorded account's threads leave the live chat store for a fenced
  store kept per account. The new account's upload never sees them. The panel
  then opens a thread for the new account on the current project.
- When the fenced account signs in again, its threads come back to their
  projects, or are merged into the thread that took the project meanwhile, and
  then upload to that account as usual.
- Telemetry: no event is added, renamed or removed.
- No funnel step's code changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-account`: "Signing in again keeps the work and the place" says
  what another account's sign-in does with the ended session's chat threads,
  instead of calling it an ordinary sign-in.

## Impact

- `client-v2/src/features/persistence/model`: a new `thread-fence.ts`, and
  `chat-sync.ts` (`forget` clears the owner after a whole hand-over; `push`
  refuses a fenced thread).
- `client-v2/src/effects/session/session.tsx`: `adopt` settles the owner
  before the chat adoption and dump, and reopens the panel's thread when it
  fenced the open one.
- User-visible: after another account signs in, the assistant panel shows that
  account's conversation, never the previous one's.
- Out of scope: project sync (already per account), the server, a sign-out's
  hand-over rules, and a session that ended before this ships with no owner
  recorded on the device (its next sign-in records one and fences nothing).
