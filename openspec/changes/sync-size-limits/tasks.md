# Tasks

Task 1.1 needs no code and runs any time before group 2 merges. Tasks 2.2,
3.1 and 3.2 depend on task 2.1, which adds the `project` entity, and may run at
the same time once 2.1 has merged.

## 1. Evidence

- [ ] 1.1 Record the platform probe (HOO-2418). Send a 5 MB
  `PUT /api/projects` to a preview deployment and record the status and date.
  Verified by the result, dated, pasted into the description of the PR for
  task 2.2. The production census this task also held is moot: client-v2 is
  not in production, so nothing is stored there (user, 2026-11-02).

## 2. Server

- [x] 2.1 Add the `src/entities/project` slice: `limits.mjs` with
  `PROJECT_LIMITS`, `SYNCED_WORKSPACE_FILES` (moved from
  `features/persistence/model/snapshot.ts`, which re-exports it) and
  `checkProjectLimits`, exported through `index.ts` and `server.mjs`
  (HOO-2418). Verified by `limits.test.mjs` under `yarn test-api`, covering
  each limit at the boundary and one over, a multi-byte file, the generated
  files left out of the count, `.workspace/metadata.json` left out of
  everything, and the order path, file size, file count, project size; and by
  `yarn lint` and `yarn test-unit` passing with `snapshot.ts` re-exporting the
  list.
- [x] 2.2 Enforce the limits in `PUT /api/projects` (HOO-2418, depends on 2.1):
  `MAX_BODY_BYTES` becomes 1 MiB, `describeWrite` refuses a file or
  path over its limit, and `writeProject` measures the resulting project and
  rolls back over the count or size limit, answering 413 with the body the
  spec's "The refusal body says what is over" requires. Update the 8 MB figure
  in the `MAX_BODY_BYTES` comment, `.claude/rules/project-sync.md` and
  `docs/persistent-conversations-spec.md`. Verified by `api/projects.test.mjs`
  and `model/projects.test.mjs` under `yarn test-api` with `DATABASE_URL` set:
  each scenario of "The server refuses a write that leaves a project over a
  limit" and "The request body is capped at 1 MiB", and a refused patch leaving
  the project's rows and `updated_at` unchanged.

## 3. Client

- [x] 3.1 Check the limits before every upload and name them on the banner
  (HOO-2418, depends on 2.1). `push` checks the full snapshot and raises
  `too-large` with `limit`; `refusalKind` reads the four reasons; `_raise`'s
  identity key includes `limit`; `SyncBanner` gets `data-testid="sync-banner"`
  and the copy in "The banner names the limit and what is over it". Declare
  `sync_file_limit_exceeded`, `sync_project_limit_exceeded` and
  `sync_files_count_limit_exceeded` in `model/telemetry.ts` with doc comments,
  and emit them from `_raise`. Verified by `project-sync.test.ts` covering no
  request sent, the mark unchanged, a server 413 raising the same banner, retry
  re-checking, and each event's parameters asserted through the memory
  provider; and by a `SyncBanner` test rendering each banner text in the spec.
- [x] 3.2 Refuse explorer writes past a limit (HOO-2418, depends on 2.1):
  `PgExplorer.createItem` calls `checkFileWrite` (only what the write makes
  worse); `renameItem` and `createWorkspace` call `checkProjectLimits` on the
  project as it would be; each throws the spec's message before any write; `CreateItem.tsx` shows the message instead of a
  boolean error; `CreateItem`, `RenameItem` and the import dialogs put it in
  `data-testid="explorer-limit-error"`. Add `src/utils/explorer/telemetry.ts`
  declaring `explorer_limit_refused` with a doc comment, register
  `explorer: "explorer"` in `EVENT_PREFIXES`, and fire it from the three
  methods. Verified by an `explorer.test.ts` case per scenario of "The explorer
  refuses to create a file past a limit", "The explorer refuses a rename past
  the path limit" and "An import past a limit creates nothing", asserting
  nothing was written and the event's parameters through the memory provider;
  by a test that creates a workspace from every framework template and
  tutorial without a refusal; and by a test that `saveFileToState` and
  `replaceWorkspaceFiles` write a file over the size limit.
  An approved assistant write the explorer refuses marks its approval card
  `failed` with `not written: <message>` as its outcome; verified by a
  `BaseApprovalCard` test, a store test, and an assertion on the card in the
  e2e scenario "The assistant writes a file over the size limit".
- [x] 3.3 Cover the spec's scenarios in Playwright (HOO-2418, depends on 3.1
  and 3.2):
  `e2e/project-sync-limits.e2e.spec.ts`, titled `project-sync-limits:
  <scenario>`, with `/api/projects` stubbed by `page.route`, for "One file over
  the file size limit", "Too many files", "The user removed the large file",
  "The client check is bypassed", "A tutorial project", "The 51st file from
  the New File dialog" and "A folder of 64 files from disk". Mark the server-side
  and restore scenarios `(manual)` in the spec where an e2e stub cannot show
  them. Verified by `yarn test-e2e e2e/project-sync-limits.e2e.spec.ts`
  passing and `yarn spec:coverage` listing none of this capability's scenarios.

## Workflow follow-up

- Ask a human whether to archive the change before opening the PR that ticks
  the last task.
