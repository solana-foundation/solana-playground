# Design

## Context

See proposal.md, "Why". The parts of the code this design rests on, read at
`dc22a4740` and checked again after merging `scope/users-work-2` (HOO-1729,
HOO-2326):

- `PUT /api/projects` (`client-v2/api/projects.mjs`) reads the body under
  `MAX_PROJECT_BODY_BYTES` (`features/persistence/model/project-write.mjs`),
  validates its shape in `describeWrite`, and calls
  `saveProject` (`src/features/persistence/model/projects.mjs`). `writeProject`
  runs inside one transaction: a compare-and-swap or create on `projects`, then
  `DELETE_OTHERS` / `DELETE_NAMED` and one `UPSERT_FILES` on `project_files`.
- `PgProjectSync.push` (`model/project-sync.ts`) diffs the snapshot against the
  sync mark and sends either `files` or `changed` + `removed`. A 413 already
  raises a `too-large` `Conflict`, which stops pushes for the project, and
  `SyncBanner` shows it with a "Try again" (`retry`) action.
- `SYNCED_WORKSPACE_FILES` lives in `model/snapshot.ts`, a browser module the
  server cannot import.
- `src/features/auth/config.mjs` and `src/features/agent/config.mjs` are the
  precedent for a constant both `index.ts` and `server.mjs` export.
- Every file the explorer writes goes through `PgExplorer.createItem`,
  `renameItem`, `createWorkspace`, `importWorkspace`, `replaceWorkspaceFiles`
  or the editor's `saveFileToState` (`src/utils/explorer/explorer.ts`).

## Goals / Non-Goals

**Goals:**

- One declaration of each limit, read by the explorer, the sync client and the
  server.
- The server check sees the project a patch produces, inside the same
  transaction that writes it.
- The client never sends an upload the server would refuse for a limit.

**Non-Goals:**

- Refusing the editor's own saves.
- Limits on conversation sync.
- A cleanup of stored projects already over a limit.

## Decisions

### The limits live in a new `entities/project` slice

The limits hold for a project whether or not it syncs, so they belong to the
project, not to the persistence feature. `src/entities/project/limits.mjs`
exports `PROJECT_LIMITS` (`fileBytes`, `pathChars`, `projectBytes`, `files`),
`SYNCED_WORKSPACE_FILES` (moved out of `persistence/model/snapshot.ts`, which
re-exports it) and one pure function, `checkProjectLimits(files)`. It takes a
map of workspace-relative paths to contents, keeps the paths a snapshot keeps
(user files and `SYNCED_WORKSPACE_FILES`; the rest of `.workspace/` is dropped),
and returns the first limit the map is over with its measure, or `null`. It
measures with `new TextEncoder().encode(s).length` and `[...path].length`, so
the browser and Node run the same lines. The slice's `index.ts` serves browser
code and its `server.mjs` serves `persistence/server.mjs`, as the layer rules
require. The body cap stays out of the slice: it is a property of the write,
not of a project, and lives as `MAX_PROJECT_BODY_BYTES` in
`features/persistence/model/project-write.mjs`, where HOO-1729 put it so the
browser and the route read one number.

Alternatives: `features/persistence/config.mjs`, as the `auth` and `agent`
slices hold theirs, which the explorer would then import from a feature for a
rule that is not about sync; or a constant in each caller. Copies of a limit
drift, and the rule "a string two places must agree on is declared once"
(`client-v2/CLAUDE.md`) covers numbers the same way.

### The explorer checks in its three write methods

`renameItem` and `createWorkspace` (with `files`) build the project's file map
as it would be after the operation and call `checkProjectLimits` before their
first write. `PgExplorer.createItem` calls `checkWriteTo` instead, which
judges the written file's own path and size, then the project's file count and
size as the write leaves them. It judges the result, as the server does, so an
overwrite that shrinks a file or a project still over its limit is refused: a
project restored over a limit takes deletes, which are never checked, and only
the writes that bring it back under. Another file's path or size never refuses
the write, because a refusal must not name a file the write did not touch; the
sync banner names that file on the next upload. Over a limit, the three
methods throw an `Error` whose message is the spec's text, and write nothing. Checking in
these methods rather than in each dialog covers every caller: the dialogs, the
assistant's `applyPatch` in `views/sidebar/assistant/bridge/playground-bridge.ts`,
the `sugar` commands, and the tutorial and template flows. One write is
exempt: a file the playground generates from work already done, the Sugar
cache, goes through `writeGeneratedFileWith`, which skips the refusal. The
cache holds the links of uploads already paid for, so refusing its save loses
them; a project it leaves over a limit stays local and the sync banner names
the limit.

An approved assistant write that the explorer refuses marks its approval card
`failed`, a new `ApprovalStatus` badged "Failed", with `not written: <message>`
as its outcome. The user then reads the reason even when the model does not
pass it on. The build and deploy tools mark their own failures the same way.

The editor's save path (`saveFileToState` and Monaco's autosave) and the sync
writes (`importWorkspace`, `replaceWorkspaceFiles`) do not call the check. A
refused autosave would lose typing, and a refused restore would strand the
user's own work once a later change to a limit, or to what it counts, leaves a
stored project over it; the sync banner reports both.

`CreateItem.tsx` holds its error as a boolean; it changes to the message string,
shown in an element with `data-testid="explorer-limit-error"`, as `RenameItem`
and the import dialogs already show a string.

### The explorer's event lives beside the explorer

The explorer is a legacy root with no slice and no tracker. A tracker in
`src/utils/explorer/telemetry.ts`, created with `createTracker`, declares
`explorer_limit_refused`, and `EVENT_PREFIXES` gains `explorer: "explorer"`.
The three methods fire it where they throw. When the explorer moves into a
slice, the tracker moves with it and keeps the event name.

Alternative: fire it from the `project` entity's check. The check also runs on
the sync path, where it is not a refusal by the explorer, so the event would
need the caller passed in.

### The server checks the resulting project after the writes, then rolls back

`describeWrite` runs `checkProjectLimits` on `files` or `changed` and answers
413 before touching the database: a request file over the path or file limit
puts the project over it whatever is stored. That is an early refusal, not the
enforcement. The count and the total size depend on rows already stored, and a
row stored before the limits, or by a path that skipped the route, can be over
the path or file limit itself, so `writeProject` runs one more statement after
its writes and measures every limit over the stored project:

```sql
select array_agg(path) filter (where char_length(path) > $4) as long,
       jsonb_object_agg(path, octet_length(content))
         filter (where octet_length(content) > $5) as large,
       count(*) filter (where not (path = any($3::text[])))::int as files,
       coalesce(sum(octet_length(content)), 0)::bigint as bytes
  from project_files
 where user_id = $1 and project_id = $2
   and (path = any($3::text[]) or not starts_with(path, '.workspace/'))
```

`$3` is `SYNCED_WORKSPACE_FILES`, `$4` the path limit and `$5` the file limit.
Only paths sync carries are measured, as on the client, so a `.workspace/` row
stored before the route refused them weighs nothing the client cannot see. The
checks run in the client's order: path, file size, count, project size. Over a
limit, `writeProject` throws the existing `WriteRefused` with `{limit}`, and
`saveProject` returns that outcome as it returns HOO-2326's no-files refusal,
so the transaction rolls back and nothing is written. Measuring the result
means a write that shrinks a file or a project still over its limit is
refused; a project that holds an oversized row takes only a write that brings
it back under, such as one that removes the row.

Alternative: compute the result before writing, by reading every stored row's
path and size and applying the patch in JavaScript. That is a second model of
`DELETE_OTHERS` and `UPSERT_FILES` that can disagree with the SQL. Measuring
after the writes measures what the statements did.

`octet_length` of a `text` column is its UTF-8 byte count in a UTF-8 database,
the same measure as `TextEncoder` on the client, and `char_length` counts code
points, the same measure as `[...path].length`.

### The client checks the full snapshot, not the patch

`push` runs `checkProjectLimits(snapshot.files)` after the outstanding-conflict
check and before building the request. A patch is small even when the project
is not, so checking the patch would send uploads the server refuses for
`project-too-large` and `too-many-files`. Over a limit, `push` raises a
`too-large` `Conflict` without a request and returns `"conflict"`, the same
path a 413 takes. The sync base is still captured first, as for every other
refusal.

### `Conflict` carries the limit, and `ConflictKind` does not grow

`too-large` stays the one kind for "the server will not take this project".
Its `too-large` member gains an optional `limit`, a `LimitExceeded`: the
shape of the 413 body. A `too-large` without `limit` is the body cap refusal,
whose banner names the cap. `refusalOf` maps each of the four new reasons to
`too-large` and reads the rest of the body into `limit`.

Alternative: four new `ConflictKind`s. Every switch over `ConflictKind`
(`SyncBanner`'s copy table, the resolution handlers) would gain four entries
that all behave like `too-large`.

### `retry` re-runs the check

The `retry` resolution clears the conflict and calls `push`, which runs the
check first. Still over, `push` raises the conflict again with the current
limit. This is the existing `retry` path; it needs no new branch.

### Telemetry fires in `_raiseFoundBy`

The event fires where a `too-large` conflict with a `limit` is raised by a
check that found it: `_raiseFoundBy(by)`, which both the client check and a
413 call. `_raise` itself sends no event, so a question put back after a retry
is not counted twice. `_raise` returns early for a conflict identical to the one
outstanding, which gives "a banner already up sends nothing more";
`sameQuestion` compares `limit` too, so a retry that finds a different limit replaces
the banner and fires that limit's event.

### No database constraint

A `CHECK (octet_length(content) <= 131072)` on `project_files` would be a third
copy of the limit, in SQL, changeable only by a migration, and existing rows
over it need `NOT VALID`. `api/projects.mjs` is the only writer of
`project_files`, so the route check covers every write.

### The body cap follows from the project limit

1 MiB is twice the project limit, so a full upload of a project at the limit
fits unless JSON escaping more than doubles it, which takes content made mostly
of control characters. Such a body is refused with `too-large`, and the banner
names the body cap (`MAX_PROJECT_BODY_LABEL`, which HOO-1729 introduced at
4 MB and this change lowers). The cap is below Vercel's documented 4.5 MB, so the
platform figure no longer decides anything; the PR still records a dated probe,
as HOO-2418 asks.

### The account cap (HOO-2538)

**The figures.** 10 projects, the owner's choice (2026-11-04). Tutorials
count apart, at 32: the client ships 16, and counting them with projects would
leave an account that had started ten tutorials unable to sync a single
project of its own. They still need a cap, because a tutorial's id is
`tut:<name>` with the name chosen by the client, so a client can make as many
as it likes. 32 is twice the catalogue. `ACCOUNT_LIMITS` (`projects`,
`tutorials`) sits beside `PROJECT_LIMITS` in `entities/project/limits.mjs`.

**What counts.** A live row (`deleted_at is null`) of the kind that holds at
least one synced file. A tombstone does not, which answers the ticket's open
question: a delete frees a place. Nor does a row with no files, the parent a
chat turn makes (`ensureThread`), which holds no code; the conversations are
conversation sync's to bound. A project the server holds and the writing
device does not counts: the server counts what it stores, and reconcile brings
every account project onto a signed-in device anyway.

**Which writes are judged.** A write that makes a project count: one to a row
that held no synced file before it. `CREATE` only ever lets such a row
through (a new row, an empty parent, a tutorial's tombstone). A swap can reach
one too: a client that reads an empty parent row's `updated_at` can swap files
into it, so `SWAP` returns `had_files` from its own snapshot and a swap with
`had_files` false is judged like a create. A write to a project that already
counts is never judged, so an account over the cap (a lowered figure, a race
lost before this change) keeps editing what it has.

**Where and when.** In `writeProject`, after the writes and the size measure,
in the same transaction, as the other limits are: over the cap it throws
`WriteRefused({limit})` and the writes roll back. The limit is
`{reason: "too-many-projects", kind, limit, count}`, `count` including the
project being written.

**The race.** Two creates at 9 would each count 9 others under READ COMMITTED
and both pass. Before counting, the transaction takes
`pg_advisory_xact_lock` keyed by a hash of `projects-cap:` and the user id, in
a statement of its own, then counts in the next: a statement's snapshot is
taken when it starts, so the count must start after the lock is held, and by
then the holder before it has committed. The lock is taken only by a write
being judged, after its row writes and before commit, and nothing waits on a
row while holding it, so it cannot deadlock with the row locks. A hash
collision between two users only serialises their creates.

Alternatives: `select ... for update` on the user's `"user"` row, which
better-auth also writes and which ties the cap to the auth schema; or a
counter column, which needs a migration and a second copy of a number the
rows already hold. Counting uses `projects_user_idx`, so no migration.

**The status.** 413 with its own `reason`, as the ticket asks and as the
other limits answer. It keeps the client on its one refusal path: `refusalOf`
reads the body into a `too-large` `Conflict` with a `limit`, pushes for the
project stop, and the banner offers "Try again". 409 would read as a
divergence to this client and the pre-#40 one; 403 and 429 would fall into the
silent "skipped" branch and retry on every debounce.

**The client.** No count check before uploading: the server is the only
place that knows what the account holds, and a device's list is stale the
moment another device creates. The explorer does not refuse an 11th project
either: a project is the user's work whether or not it syncs, a signed-out
user has no account to count against, and a refusal based on a guess would
block work to protect a quota. The project stays local and the banner says
so. A refused create writes no sync mark, so `releaseLocalProjects` (no mark,
not releasable) keeps it at sign-out, `pushNeverSynced` still sees it as
never synced, and reconcile, which deletes only a project whose mark says the
account had it, leaves it alone. It is not retried in a loop: the outstanding
conflict stops its pushes until "Try again", and a reload's reconcile sends
one create per refused project, which succeeds once a place is free.

## Risks / Trade-offs

- [A later change lowers a limit or counts more, and stored projects end up
  over it] → they still restore and open, their next edit raises the banner,
  and `checkWriteTo` does not refuse the edits that bring them back under.
  No stored project predates these limits: client-v2 has not reached
  production (2026-11-02).
- [The generated `program-info.json` holds an IDL and grows with the program]
  → it counts toward the project size. A 512 KiB project leaves room for any
  IDL the bundled tutorials produce, and a larger one raises the project size
  banner like any other file.
- [The client and the server disagree on a measure] → `describeWrite` calls
  `checkProjectLimits`, and the SQL takes the same measures: `octet_length` and
  `char_length`. The server tests feed a multi-byte file and a multi-byte path
  at the limit, so a measure that drifts fails there.
- [A device holding many unsynced projects signs in to a full account] → each
  over the cap costs one refused create per page load, and the banner shows
  on whichever of them is open; the others show it when opened (the
  follow-up `SyncBanner` already names).
- [A stale client without the check uploads a large project] → the server
  refuses it with a named reason, and a client from before this change shows
  its existing "too large" banner for any 413.

## Migration Plan

1. Record the preview probe (task 1.1). Nothing is deployed by it.
2. Ship the server check and the client check. No database migration.
3. Rollback is a revert: no stored data changes shape.
