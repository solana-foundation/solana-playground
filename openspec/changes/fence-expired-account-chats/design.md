# Design

## Context

- `adopt` in `effects/session/session.tsx` runs `PgChatSync.adoptAccountThreads()`
  then `PgChatSync.pushAll()` on every sign-in. `pushAll` uploads every thread
  `PgThreadIndex` names and every file under `/.config/chats`.
- An ended session leaves `PgSession.get()` empty and sets `expiredUser`;
  `relinquish` (the sign-out teardown) does not run, and the chat effect leaves
  the open thread alone. By the time the next user arrives, `expiredUser` is
  already cleared, and a reload, another tab or lost `localStorage` can erase
  what one tab saw.
- `PgThreadIndex._migrate` adopts any file under `/.config/chats` that no index
  entry names, as a workspace named after the thread. A thread taken out of the
  index but left in that folder would come back on the next load.

## Goals / Non-Goals

**Goals:**

- Another account's sign-in uploads none of the previous account's threads,
  whichever tab notices first and across reloads.
- Nothing is lost: the previous account gets its threads back when it signs in.
- The previous account's turn stops before its thread is moved.

**Non-Goals:**

- Several accounts' threads open side by side, or a picker between them.
- Changing what a sign-out hands over or keeps.

## Decisions

- **The owner is a file, not tab memory.** `PgThreadFence` keeps
  `/.config/chats-owner.json`, the account whose threads `/.config/chats`
  holds. A sign-in compares it with the arriving user under the sync lock, so
  the first tab to see the arrival fences and every later tab finds the owner
  already matching. Alternative: track `expiredUser` in the session effect.
  Rejected: it is gone after a reload, unknown to a tab that never saw the
  expiry, and two tabs would each fence what the other had already moved, the
  second fencing the new account's fresh threads as the old one's.
- **Fenced threads move out of `/.config/chats`.** To
  `/.config/chats-fenced/<userId>/<threadId>.json`, with
  `/.config/chats-fenced/<userId>/index.json` mapping each thread to its
  workspace (or `null` for a file the index never named). Outside the chat
  folder, `PgChatStorage.threadIds`, `pushAll`, the index migration and a
  sign-out's wholesale clear never see them. The record is written before the
  files move, and `push` refuses any thread a record names, so a page that dies
  mid-move uploads nothing either.
- **Every doubt fails closed.** An owner file that cannot be read counts as
  another account's, a record that cannot be read makes `isFenced` answer yes,
  and `push` refuses every thread while the owner is not the signed-in
  account. `settle` answers whether the folder is the arriving account's now;
  when it is not, `adopt` skips the chat adoption and the dump for this
  sign-in, and the next sign-in settles again. A copy that is not JSON is
  dropped from a merge and reported, since nothing can read it anyway;
  throwing there would fail the fence on every sign-in.
- **Stragglers are fenced again.** A tab that had the old thread open can write
  it back into `/.config/chats` before it notices the new account. Every
  settle moves a file whose id a fence record names back into its fence,
  merged with the fenced copy (`mergeThreads`), before the dump.
- **Restore on the owner's next sign-in.** A fenced thread whose workspace has
  no entry gets its entry back; one whose workspace took a new thread meanwhile
  is merged into that thread, which uploads to the same account in the same
  dump. A thread with no workspace goes back as an unindexed file, as it was.
- **The open thread closes before the move.** `adopt` asks whether the owner
  differs, and if so stops the turn (`PgAssistant.stopTurn`), closes the
  thread and waits for its writes before `settle`; afterwards it opens a thread
  for the current workspace through `openThread`, which adopts the account's
  own when the server has one. Not `PgAssistant.clear`: with a thread open
  nothing unsaved is held, and with none open what the panel holds is the
  arriving user's typing.
- **A whole hand-over clears the owner.** `PgChatSync.forget`'s wholesale
  branch removes the owner file with the folder; a partial one keeps it, so a
  thread a sign-out failed to upload is fenced from the next account too.

## Risks / Trade-offs

- [A session that ended before this ships has no owner file] → the next
  sign-in records one and fences nothing: the leak this fixes can happen once
  per device across the deploy. Accepted; the window is a session lifetime.
- [A fence that cannot finish (storage full, an unreadable file)] → nothing
  uploads, but the old account's thread stays indexed, and the chat effect can
  open it on the next project switch. The arriving account could read it
  until a later sign-in settles. Accepted for a failure this rare; the upload
  leak, which crosses to the server, stays closed.
- [Threads written while signed out after a partial sign-out] → they are fenced
  as the previous account's, and come back when that account signs in. Today
  they upload into whoever signs in next; keeping them is the safer error.
