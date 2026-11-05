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
  `MAX_PROJECT_BODY_BYTES` becomes 1 MiB, `describeWrite` refuses a file or
  path over its limit, and `writeProject` measures the resulting project and
  rolls back over any limit, measured over every stored row, answering 413 with the body the
  spec's "The refusal body says what is over" requires. Update the body cap figure
  in the `MAX_PROJECT_BODY_BYTES` comment, `.claude/rules/project-sync.md` and
  `docs/persistent-conversations-spec.md`. Verified by `api/projects.test.mjs`
  and `model/projects.test.mjs` under `yarn test-api` with `DATABASE_URL` set:
  each scenario of "The server refuses a write that leaves a project over a
  limit" and "The request body is capped at 1 MiB", and a refused patch leaving
  the project's rows and `updated_at` unchanged.

## 3. Client

- [x] 3.1 Check the limits before every upload and name them on the banner
  (HOO-2418, depends on 2.1). `push` checks the full snapshot and raises
  `too-large` with `limit`; `refusalOf` reads the four reasons; `sameQuestion`
  compares `limit`; `SyncBanner` gets `data-testid="sync-banner"`
  and the copy in "The banner names the limit and what is over it". Declare
  `sync_file_limit_exceeded`, `sync_project_limit_exceeded` and
  `sync_files_count_limit_exceeded` in `model/telemetry.ts` with doc comments,
  and emit them from `_raise`. Verified by `project-sync.test.ts` covering no
  request sent, the mark unchanged, a server 413 raising the same banner, retry
  re-checking, and each event's parameters asserted through the memory
  provider; and by a `SyncBanner` test rendering each banner text in the spec.
- [x] 3.2 Refuse explorer writes past a limit (HOO-2418, depends on 2.1):
  `PgExplorer.createItem` calls `checkFileWrite` (the written file, and the
  project as the write leaves it); `renameItem` and `createWorkspace` call `checkProjectLimits` on the
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

- [x] 3.4 Keep a project at sign-out while sync owes it (HOO-2418, depends on
  3.1): `releaseLocalProjects` keeps a project with an outstanding question or
  a generated file whose hash differs from the mark. Verified by
  `project-restore.test.ts` cases for a changed `program-info.json`, an
  outstanding question, and a built project the account already holds.

## 4. Account cap

- [x] 4.1 Cap the projects an account syncs (HOO-2538, depends on 2.2 and
  3.1): `ACCOUNT_LIMITS` (`projects: 10`, `tutorials: 32`) and the
  `too-many-projects` shape in `limits.mjs`, read by `readLimitExceeded`;
  `SWAP` returns `had_files`; `writeProject` takes the per-account advisory
  lock and counts for a write that makes a project count, throwing
  `WriteRefused({limit})`; `limitBannerText` words the cap;
  `sync_projects_count_limit_exceeded` declared in `model/telemetry.ts` and
  sent from `_raise`. Verified by `model/projects.test.mjs` and
  `api/projects.test.mjs` under `yarn test-api` with `DATABASE_URL` set: the
  11th create refused with nothing written, an update at 10 accepted, a delete
  then a create accepted, two concurrent creates at 9 letting exactly one
  through, tutorials counted apart, an empty row filled by a swap refused; by
  `project-sync.test.ts` and `project-restore.test.ts`: the refusal raises the
  banner and the event, writes no mark, sends nothing more until "Try again",
  and neither reconcile nor sign-out deletes the project; and by the e2e
  scenario "The account is at the project cap".

## Workflow follow-up

- Ask a human whether to archive the change before opening the PR that ticks
  the last task.
