# CLAUDE.md

Working notes for this repo. Style rules live in `CONTRIBUTING.md` — read it
before writing TypeScript or Rust; it is detailed and upstream-authoritative.
This file records only what the code and git history do not make obvious.

## This is a fork

`solana-foundation/solana-playground`, forked from
`solana-playground/solana-playground`.

`solana-foundation/solana-playground` `master` is the reference. Work lands
there through PRs, and upstream `solana-playground/solana-playground` reaches
it as squashed sync commits, each a chunk of upstream functionality, named
`chore(upstream): sync to <sha> (<range>)`. `hoodieshq/solana-playground`
forks `solana-foundation/solana-playground`; `master` is the default branch
of both.

The integration branches are `master` and `new-face`. Feature branches come
off `master`, the default, and PRs go against `master`; redesign branches
(section 5, "Screens", of the OpenSpec change `ui-migration`) come off
`new-face` and PRs go against `new-face`.

`ci.yml` checks formatting for `client/`, `server/`, and `wasm/` and clippy
for `server/` and `wasm/`, but not `client/`'s build or tests;
`client-v2.yml` guards `client-v2/`, with its production build and the
checks on what that build emits in `reusable-client-v2-build.yml`. `ci.yml`
and `client-v2.yml` run on pushes to `master` (`client-v2.yml` also on
pushes to `new-face`) and on every PR: a `pull_request` run reads the
workflow from the PR's merge commit, and no `pull_request` workflow runs
while the PR has a merge conflict. `preview.yml` deploys a labelled PR's
preview and `preview-sweep.yml` cleans up after it on a schedule; both run
only in the repository the `PREVIEW_REPOSITORY` variable names, once
`NEON_PROJECT_ID` is set there. GitHub runs scheduled workflows only from
the default branch.

`cicd.yml` deploys App Engine from a tagged commit on `master`. A push to
`master` also deploys `client-v2` to Vercel production, so run
`migrate-production-db` first when migrations are pending: "migrate first,
then merge to `master`"
([deploy-client-vercel.md, "Conversation and project sync"](client-v2/docs/deploy-client-vercel.md#conversation-and-project-sync)).

Greptile reviews only PRs into `master` on the foundation repository, as
`greptile.json` configures. When adding a file of review rules, add it to `customContext.files` in
`greptile.json`. Specs need no entry: its instructions point at `openspec/`.

## Two clients

- `client/` — upstream's. Largely untouched here. Don't edit unless the task
  says so.
- `client-v2/` — **where the fork's work happens**: the AI assistant panel, the
  Solana-brand theme, the Flow layout. Default to this one.

`server/` and `wasm/` are upstream's and out of scope per the project's
own principles ("No backend changes").

## Commit messages

The fork uses Conventional Commits (`feat:`, `fix:`, `chore:`, with an optional
`(client-v2)` / `(tutorials)` scope). This **contradicts `CONTRIBUTING.md`**,
which describes upstream's `server: Add feature` / no-prefix-for-client style.
Follow the fork's convention; follow CONTRIBUTING only in a PR meant for
upstream.

## Setup and commands

Node is pinned by `.nvmrc`; package manager is yarn 1.x.
All commands run from `client-v2/`.

```sh
../wasm/stub-packages.sh   # REQUIRED before first install (see below)
yarn install --frozen-lockfile
yarn dev                   # generate-fast + craco start
yarn build                 # the whole production build: wasm/build.sh, install, build:bundle (~1h first run)
yarn build:bundle          # lint:layers + generate + craco build + source-map upload, over whatever wasm/*/pkg holds; Vercel runs this
yarn test                  # test-types + test-unit + build:bundle
yarn test-types            # tsc --noEmit
yarn test-e2e              # playwright
yarn test-api              # node --test, for api/ and **/server/*.mjs
yarn check-format          # prettier; CI enforces this
yarn lint                  # eslint over src/, api/, e2e/; CI enforces this
yarn spec:validate         # openspec validate --all --strict; CI enforces this
yarn run check             # everything CI runs, minus the production build;
                           # `run` is required: yarn 1's built-in `check` shadows the script
yarn db-migrate            # dbmate up; reads client-v2/.env
yarn db-status             # which migrations are applied
yarn db-dump               # regenerate db/schema.sql after a migration
```

`make help` at the root lists Vercel deploy targets.

Once per machine, for planning: `npm i -g @fission-ai/openspec@latest`
(or `brew install openspec`). The `/opsx:*` commands committed under
`.claude/` call it.

## Frontend rules and specs

`client-v2/CLAUDE.md` is loaded whenever work happens in that folder and
holds the rules for the client: layers, components, what review keeps
finding, the checklist before a PR, and the OpenSpec workflow. Specs and
change proposals live in `openspec/`; `openspec list` shows the active
changes. Asked to build something in the client, look there first.

## Gotchas

- **Production runs one database, Postgres,** for conversation and project
  sync, reached only from `client-v2/api/*.mjs`. (Upstream's Rust build
  server in `server/` is written against MongoDB; it exists here only in the
  code and in the local `compose.yaml`, untouched.) Migrations live in
  `client-v2/db/migrations`, are applied with `yarn db-migrate`, and are never
  run from a serverless function. `db/schema.sql` is generated by
  `yarn db-dump` (which runs `pg_dump` inside the compose container, so no host
  Postgres client is needed) -- regenerate it whenever a migration changes.
- **`api/*.mjs` is not covered by `yarn test-unit`.** vitest collects
  `.js`, `.jsx`, `.ts` and `.tsx` test files under `src` and the in-source
  test blocks of `src/**/*.{ts,tsx}` (`include` and `includeSource` in
  `vitest.config.ts`), so no `.mjs`, and the server modules need real Node.
  Run `yarn test-api` (`node --test`); it loads `client-v2/.env`, and the
  database-backed cases skip themselves without `DATABASE_URL` rather than
  failing.
- **Secrets live in `client-v2/.env`**, not `.env.local` -- so dbmate and
  `yarn test-api` find them without an env prefix on the command. Both names
  are gitignored.
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
- **In-browser migration covers the pre-sync layout, plus one read of the
  first sync client's mark.** `PgWorkspace.migrate` (workspace ids) and
  `PgThreadIndex._migrate` (thread files to `<threadId>.json` + index). A
  sync mark `read` cannot parse is `null` ("never agreed", merged against an
  empty base), yet still keeps its project out of `pushNeverSynced`
  (`PgSyncMark.exists`). One older shape is still read on purpose: the
  whole-snapshot mark the first sync client wrote, which production browsers
  hold. Where the row still stands at its `updatedAt`, reconcile rebuilds it
  per file from the server's copy (`rebaseWholeSnapshotMark` in
  `project-restore.ts`), so unpushed edits push and unpushed deletes stay
  deleted instead of merging against nothing. A future format change that
  ships to users adds its own step; it does not chain through dropped ones.
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
  are folded in with `merge3`. `_catchUp` does it twice, before the re-open
  and after it: the editor registers its buffers only once its lazy chunk and
  `initLanguages` are done, so under load it can mount mid-sync, build its
  model from memory not yet re-read, and have the re-open reuse it -- the pane
  kept the replaced file (HOO-2119). The second pass also sets memory, which
  the re-open has already read.
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
- **`push` refuses an empty snapshot, whoever calls it.**
  `replaceWorkspaceFiles` removes the directory before writing the taken copy
  back, another tab can rename or delete it away, and an interrupted import
  or replace can leave a registered workspace with no files in the
  store; a push from that state (the editor's, reconcile's, or a banner's
  `retry`) would upload nothing over whatever the server holds.
- **`replaceWorkspaceFiles` preserves `.workspace/metadata.json`.** Which tabs
  are open is local state the snapshot deliberately excludes, so sync must not
  be what deletes it -- and with no tabs there is no current file, so the
  editor has nothing to re-read and goes on showing the version the user just
  replaced. `_initCurrentWorkspace` also falls back to the default open file
  when the metadata names none, so re-reading a workspace always lands
  somewhere.
- **Typing folded in by sync has its base kept on the spot.** A merge or an
  adoption folds typing into the files it rewrote (`_catchUp`), before the
  re-open or, for an editor that mounted meanwhile, after it -- and the sync
  effect re-takes the shadow from memory, which then holds the folded copy and
  no longer hashes to the mark. So `_adopt` and `_mergeWithServer`
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
- **No write may leave a project with no files.** A row with none reads back
  as `snapshot: null`, which no device can merge with or take, so the server
  refuses an empty `files` up front and a patch that empties the row inside
  the transaction (`saveProject`, rolled back). The patch refusal is a 400
  with `reason: "no-files"` (`NO_FILES_REASON`), never a 409; the browser
  only meets it against a row emptied before the server checked, and answers
  with its whole file set once (`_push`, `whole`).
- **`/api/projects` still takes the pre-#40 client's body.** A tab open
  across that deploy sends `{snapshot: {files}, baseUpdatedAt, force: false}`
  and drops every status but 409 and 413 silently, so `describeWrite` reads
  `snapshot` as `files`, `force: false` as absent, and answers `force: true`
  with a 409. Both doors can go once no such tab can still be open.
- **Only a visible tab pushes.** Tabs share IndexedDB but hold the _current_
  workspace in memory separately, so a backgrounded tab's snapshot goes stale;
  it flushes on `visibilitychange` -> `hidden` (not `beforeunload`, which is
  too late, and not `keepalive`, which caps at ~64 KB against a 4 MB limit)
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

- **`wasm/` carries two fork-owned pins that an upstream sync must keep:**
  the exact `wasm-bindgen` version under `[workspace.dependencies]` in
  `wasm/Cargo.toml`, which every member that depends on `wasm-bindgen`
  references with `workspace = true`, and the one in
  `wasm/rust-analyzer/Cargo.toml`, outside the workspace. wasm-pack needs a
  `wasm-bindgen` binary at the exact crate version, and
  `client-v2/scripts/vercel-install.sh` installs it from what those pins lock
  (`client-v2/docs/deploy-client-vercel.md`, "wasm-bindgen"). A bump changes
  the pin and the lockfile together.
- **`wasm/stub-packages.sh` is not optional.** Six of the eight local
  `wasm/*/pkg` deps compile from Rust and take about an hour. `yarn install`
  refuses to run while those directories are missing. None is on the UI or test
  path, so the stubs are correct for everything except a real WASM build
  (`wasm/build.sh`). Rust intellisense and the `solana`/`anchor`/`spl-token`/
  `sugar` terminal commands are stubbed out and throw a clear message.
- **`client-v2/public/` is gitignored and generated**, not authored.
  `scripts/update-static.mjs` copies it out of the `client/public` git submodule
  and dates tutorials from that submodule's history — so the submodule needs
  full history (`fetch-depth: 0`), not a shallow checkout.
- **`docs/assistant-context.md` is the in-product assistant's context**, not
  Claude Code's. It is the source of truth; `yarn sync-assistant-context` copies
  it into `client-v2/src/views/sidebar/assistant/content/`. Edit the `docs/` copy.
  It is also the best single description of what the fork is building and what is
  real vs mocked — read it before answering product questions.
- **`docs/decisions.md`, `docs/product-brief.md` and `codebase-map.yaml` are
  referenced throughout but do not exist in this repo.** Don't cite them as if
  they do; the D-numbers in comments (`D6`, `D19`) have no resolvable target here.
- Building against the public server (`https://api.solpg.io`) works from
  `localhost:3000` — CORS allows it. No Docker or Rust toolchain needed to run
  the client.
