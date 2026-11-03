# Proposal

## Why

Project sync had no limit on a file, a project or a file count. `PUT /api/projects`
capped only the request body, at 8 MB when this change was proposed and at 4 MB
since HOO-1729. A patch carries only the changed files, so a project of any size
syncs until a full upload goes over that cap. The 8 MB comment said Vercel
accepts 100 MB, but
[Vercel's limits page](https://vercel.com/docs/functions/limitations#request-body-size)
says 4.5 MB, which HOO-1729 then followed. HOO-2418.

The largest file in the bundled tutorials is 7.8 KB (`battle-coins` `src/lib.rs`,
about 210 lines). The largest tutorial holds 12.5 KB of code in 3 files.
Measured over this repository, a line of Rust averages 36 bytes. A Playground
project is an exercise, so the limits sit far above those figures and far below
the platform's.

## What Changes

- A project is held to four limits, signed in or not:
  - a file's content is at most 128 KiB (about 3,600 lines);
  - a file's path is at most 256 characters;
  - the project's files hold at most 512 KiB in total (about 14,500 lines);
  - the project has at most 50 files, not counting the three generated workspace
    files sync carries (`SYNCED_WORKSPACE_FILES`).
- The file count limit also stops a project from being split into many tiny
  files, each of which is a row in `project_files`.
- The explorer refuses to create a file, rename a path or import a project
  when the result is over a limit, and says which limit. This covers the New
  File dialog, the assistant's file writes, terminal commands that write files,
  and imports from disk, GitHub, a temporary project, a template or a tutorial.
  Typing in the editor is not refused, and neither is restoring a project from
  the account.
- The client checks the whole project against the limits before every upload.
  A project over a limit is not uploaded. The existing "too large" banner names
  the limit and the file or files over it, and pushes for the project stop until
  the user presses "Try again" with the project back under every limit.
- The server refuses a write that leaves the project over a limit, with 413 and
  a named `reason`: `file-too-large`, `path-too-long`, `project-too-large` or
  `too-many-files`. A patch is checked against the project it produces, not only
  against the files it carries.
- **BREAKING** for any account holding a project over a limit: the project's next
  upload is refused until the user shrinks it. Reading, restoring and deleting
  the project still work.
- The request body cap for `PUT /api/projects` (`MAX_PROJECT_BODY_BYTES`,
  which HOO-1729 set at 4 MB in place of the 8 MB above) drops to 1 MiB, which a
  512 KiB project fits inside with room for JSON escaping. A body over it keeps
  the `too-large` reason.
- Telemetry: the persistence slice (`sync` prefix) adds three events,
  `sync_file_limit_exceeded`, `sync_project_limit_exceeded` and
  `sync_files_count_limit_exceeded`. The explorer, which has no tracker, gets
  one under a new `explorer` prefix with one event, `explorer_limit_refused`.
  No event is renamed or removed.

## Capabilities

### New Capabilities

- `project-sync-limits`: the size and count limits a project is held to, how
  the explorer, the sync client and the server enforce them, what the user is
  told, and the events that measure it.

### Modified Capabilities

None. `project-conflict-resolution` covers the divergent question and its
resolve view; the "too large" refusal is not specified there.

## Impact

- `client-v2/api/projects.mjs`: the per-file and path checks in
  `describeWrite`, and the 413 reasons. The body cap is
  `MAX_PROJECT_BODY_BYTES` in `features/persistence/model/project-write.mjs`.
- `client-v2/src/entities/project`: a new entity holding the limits, the
  generated workspace file list and the check, read by the server, the sync
  client and the explorer.
- `client-v2/src/utils/explorer/explorer.ts`: the checks in `createItem`,
  `renameItem` and `createWorkspace`, and the explorer's tracker. The New File
  dialog (`views/sidebar/explorer/Component/Modals/CreateItem.tsx`) shows the
  refusal's message instead of a bare error state.
- `client-v2/src/features/persistence`: the project check in
  `model/projects.mjs`; the pre-upload check in
  `model/project-sync.ts`; the banner copy in `Component/SyncBanner.tsx`; the
  events in `model/telemetry.ts`.
- `.claude/rules/project-sync.md`, `docs/persistent-conversations-spec.md` and
  `client-v2/docs/deploy-client-vercel.md` cite the body cap; all three are
  updated.
- Users are told at the moment they create, rename or import something over a
  limit, and see a banner naming what to shrink when a project grows past one
  in the editor, instead of a project that uploads until it suddenly does not.

Out of scope:

- Conversation sync (`POST /api/conversations`) and its `MAX_BODY_BYTES`,
  `MAX_ITEMS` and `MAX_TITLE`.
- Refusing editor writes. A file grows past 128 KiB by typing or pasting, and
  Monaco's autosave writes it; the sync banner reports it.
- Refusing a project restored from the account. None predates the limits
  (client-v2 has not reached production), but a later change to a limit or to
  what it counts can leave a stored project over it, and a refused restore
  would strand the user's own work.
- A length `CHECK` on `project_files` (see design.md, "No database constraint").
- Skipping the files over a limit and syncing the rest. The whole project stops
  syncing, as the "too large" refusal does already.
