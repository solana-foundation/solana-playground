---
paths:
  - "client-v2/src/features/persistence/**"
  - "client-v2/src/effects/**"
  - "client-v2/src/views/sidebar/assistant/**"
  - "client-v2/src/utils/explorer/**"
  - "client-v2/src/components/Editor/Monaco/**"
  - "client-v2/api/**"
  - "client-v2/db/**"
---

# Sync and persistence gotchas

Moved out of the root CLAUDE.md (token diet, 2026-10-23); loads only when a
session works under these paths.

- **Chat threads share the code's IndexedDB volume**, as files under
  `/.config/chats/<threadId>.json` via `PgFs` -- not `localStorage`, which is
  already near its origin budget with `settings`, `wallet`, `theme` and
  `flow.deploys`. A thread has an id of its own; `/.config/chats/index.json`
  (`PgThreadIndex`) maps the stable workspace id to the thread open on it, so
  a rename keeps the conversation, and anything that acts on a workspace's
  chat (a delete, "keep as new") goes through the index, never by workspace
  id against storage.
- **Chat messages are versioned, not immutable.** Every change to an existing
  item stamps `updatedAt` (`stamp` in `assistant/store.ts`); an item's version
  is `updatedAt ?? createdAt`. `appendMessages` upserts only a newer copy and
  `mergeThreads` (`model/chat-codec.ts`) keeps the newer copy, local on a tie
  -- see it for why two devices' clocks never need to agree. The open thread
  takes the server's copy through `PgAssistant.foldIn`, never a reload.
- **Project sync turns on a persisted "sync mark"**, one file per project per
  account at `/.config/sync/<userId>/<projectId>.json` (`model/sync-mark.ts`):
  a SHA-256 per file of what the server last accepted, the **name** it was
  stored under, its `updated_at`, and a `dirty` hint. Without it a fresh load
  cannot tell a local copy that is behind the account from one holding work
  that never uploaded, and the old code resolved that by always taking the
  server's -- which deleted the work. `reconcile` (`model/project-restore.ts`)
  is a 2x2 over those two questions; when both copies hold work it merges
  them, and asks the user only about lines both changed. Per account because
  a tutorial's id is derived from its name and so is identical across
  accounts.
- **There is one in-browser migration: from the pre-sync layout to the
  current one.** `PgWorkspace.migrate` (workspace ids) and
  `PgThreadIndex._migrate` (thread files to `<threadId>.json` + index). No
  intermediate format between #29 and now reached real users, so none gets
  compatibility code: a sync mark `read` cannot parse is `null` ("never
  agreed", merged against an empty base), yet still keeps its project out of
  `pushNeverSynced` (`PgSyncMark.exists`). A future format change that ships
  to users adds its own step; it does not chain through dropped ones.
- **The sync mark holds a hash per file, and that is the merge base.**
  `mark.files` is `path -> sha256` of what the server last accepted from this
  device. `isClean` compares it on _user_ files only (the three generated
  workspace files are rewritten on every open); the push compares all files to
  decide what to send. A reconcile that finds both sides moved runs a
  three-way merge (`model/merge.ts`) against it and asks only about files whose
  changed lines overlap or touch.
- **Line merges need the base content, kept copy-on-write.**
  `model/sync-base.ts` stores, under `/.config/sync-base/<userId>/`, the agreed
  content of files edited locally since the last accepted push -- taken from an
  in-memory shadow of the open workspace at push time, before the
  outstanding-conflict check. It is almost always empty. A file whose base was
  never captured (tab crashed before any push) is asked about as a whole, never
  merged on a guess. It sits outside `/.config/sync/` because
  `PgSyncMark.projectIds()` treats every file there as a mark.
- **Projects are stored one row per file** (`project_files`). A `jsonb`
  snapshot was rewritten whole on every save -- ~55x the WAL of a row per file
  for a one-file edit. `PUT /api/projects` takes either `files` (whole set;
  create-only without a token) or `changed` + `removed` (patch; token required).
- **The push gate is counted.** `holdPushes`/`releasePushes` nest, so every
  hold must be released exactly once; a single-slot gate let one holder
  release another's and pushes ran mid-merge.
- **`mergeWithServer` and `adopt` run one at a time per project.** A
  per-project queue serialises them: a second concurrent merge read stale
  memory against the first one's new mark and reverted the other device's
  lines.
- **A push whose snapshot predates a merge or adopt is dropped.** A
  per-project generation is bumped by every local rewrite, and `pushCurrent`
  reads its snapshot only after the gate, so an old snapshot cannot overwrite
  merged content.
- **A merge or adopt refreshes open editor buffers before releasing pushes.**
  It goes through the explorer's editor-buffer seam (`registerEditorBuffers`),
  because Monaco reuses an existing model on re-open and its autosave would
  otherwise write the pre-merge text back; keystrokes typed during the merge
  are folded in with `merge3`.
- **`dirty` is a hint, never a decision.** It only lets reconcile skip
  re-hashing a project; `mark.files` + `name` decide whether anything is owed. It
  was load-bearing twice and wrong both times: a workspace switch sets it on
  every page load (so nothing was ever "clean" and every difference became a
  prompt), and `PgProgramInfo` rewrites `program-info.json` with identical
  content on every load (so every reload bumped the row, which the _other_
  browser reads as "changed elsewhere"). The name is in the mark so a rename,
  which changes no bytes, still pushes.
- **The three files in `SYNCED_WORKSPACE_FILES` fire no explorer event.**
  `.tutorial.json`, `.workspace/tutorial-storage.json` and
  `.workspace/program-info.json` are written straight to the store by
  `PgTutorial`/`PgProgramInfo`, bypassing `saveFileToState` -- so the only
  files the snapshot deliberately carries were the only ones nothing ever
  scheduled an upload for. `PgFs.onDidWriteFile` exists for them; the sync
  effect filters it with `isSyncedWorkspaceFile`.
- **Never do filesystem work per filesystem write.** The dirty flag is written
  at most once per debounce window. Doing it per write put a read on the same
  lightning-fs queue as the writes that triggered it and made creating a
  workspace ~5x slower.
- **`reconcile()` runs one pass at a time and coalesces.** The session, the
  explorer's first switch, a refocus and an adoption's re-open all ask for
  one; two overlapping passes saw a workspace `importFresh` had made but not
  marked, and renamed the account's row to "X (imported)". A caller arriving
  mid-pass waits, then shares one fresh pass with everyone else who arrived
  meanwhile -- never the running pass, whose result may predate its question.
  Nothing inside a pass may await `reconcile`. The effect's `refreshing` flag
  stays too: it drops a switch from its own pass's re-open, so adopt ->
  re-open -> reconcile cannot bounce.
- **`pushCurrent` refuses an empty snapshot.** The explorer clears its file
  map before re-reading a workspace, so a push landing in that window would
  upload nothing over whatever the server holds.
- **`replaceWorkspaceFiles` preserves `.workspace/metadata.json`.** Which tabs
  are open is local state the snapshot deliberately excludes, so sync must not
  be what deletes it -- and with no tabs there is no current file, so the
  editor has nothing to re-read and goes on showing the version the user just
  replaced. `_initCurrentWorkspace` also falls back to the default open file
  when the metadata names none, so re-reading a workspace always lands
  somewhere.
- **Typing folded in by sync has its base kept on the spot.** A merge or an
  adoption folds typing into the files it rewrote (`_catchUp`), then re-opens
  the workspace -- and the sync effect re-takes the shadow from that folded
  copy, which no longer hashes to the mark. So `_adopt` and `_mergeWithServer`
  call `PgSyncBase.capture(..., from)` with what they wrote; without it the
  folded file had no base and the next exchange asked about the whole file.
  Tests that stub `switchWorkspace` (`captureWrites`) never fire the switch
  event and cannot see this; `explorerReopensFromTheStore` in
  `two-devices.test.ts` does. A base is kept by every path that can reach a
  merge: `push` before sending, the fold above, and `_mergeWithServer`'s first
  attempt (for an edit a reconcile reaches before any push). Each captures
  only content that hashes to the mark.
- **A 409 is merged, not retried.** A divergent 409 runs
  `PgProjectSync.mergeWithServer`, which re-reads the server and retries its
  own upload at most three times; what it cannot merge is raised to
  `SyncBanner` with the files named, and pushes for that project stop until
  the user answers. A row that reads as 404 is raised as `deleted-elsewhere`
  (`PgProjectSync.read` returns `"gone"`), since both version answers would
  merge against nothing.
- **Only a visible tab pushes.** Tabs share IndexedDB but hold the _current_
  workspace in memory separately, so a backgrounded tab's snapshot goes stale;
  it flushes on `visibilitychange` -> `hidden` (not `beforeunload`, which is
  too late, and not `keepalive`, which caps at ~64 KB against an 8 MB limit)
  and reconciles before it may push again.
- **Tabs agree through the store and one Web Lock.** Uploads are built from
  disk (`snapshotOf`), never from a tab's memory, which can be behind another
  tab's write. Reconcile passes, pushes, merges, adopts and banner answers all
  run under `withSyncLock` (`model/sync-lock.ts`), one lock per origin. It is
  held per tab, not per call, so a holder that reaches another locked path (a
  push that 409s and merges, a reconcile that adopts) never waits for itself.
  Take it before the per-project queue, never inside it. Each pass starts with
  `reloadCurrentFromDisk` (`model/tab-reload.ts`), and `effects/tab-sync`
  announces writes to the other tabs over `BroadcastChannel`.
- **Sync never drops a program keypair the account lacks.** Wherever the
  account's `program-info.json` replaces the local one (adopt, and `planMerge`'s
  generated-file rule), `keepLocalKeypair` (`model/merge.ts`) carries a local
  `kp` into an account copy whose `kp` is null or absent. The mark keeps the
  _server's_ hash, so the keypair reads as a local change and the next push
  uploads it. If both sides have a `kp`, the account's still wins.
- **Persistence failures are reported, not swallowed.** `chat-storage`,
  `chat-sync`, `project-sync` and `project-restore` all catch -- a lost write
  must not take the panel down -- but every failure goes through
  `model/diagnostics.ts`, which logs each one under `persistence:diagnostics`
  with `report: true`, so it reaches Sentry once a DSN is configured. In the
  browser console, `__pgSyncDiagnostics.failures()` lists them. A missing file
  is not a failure and is deliberately silent.
