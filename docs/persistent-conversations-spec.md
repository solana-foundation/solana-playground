# Persistent conversations and code — design spec

Status: agreed, 2026-09-15. Implements cross-device persistence for the
client-v2 assistant panel and project code.

## Problem

Three gaps in the current client-v2:

1. Conversations are not tied to a project or tutorial, and do not survive a
   reload. Chat is in-memory only by design (`store.ts: PgAssistant`).
2. Code lives only in this browser. Signing in "buys identity and nothing
   else" — the in-repo note at `features/github-oauth/model/github-auth.ts: GithubAuth` (at 2233963e)
   states the problem and names this work as the fix.
3. There is no way to move between conversation threads.

## Premise corrections

Facts established while designing, which contradict the original brief:

| Assumed | Actual |
| --- | --- |
| Code is in `localStorage` | Code is in **IndexedDB** via lightning-fs (`utils/explorer/fs.ts: PgFs._fs`). The `"explorer"` localStorage key is a dead legacy migration (`explorer.ts: PgExplorer._initCurrentWorkspace`). |
| Chat can follow "how code does it" | No such precedent. Chat has never been persisted. |
| There are no approval items | `write_file`, `build` and `deploy` are all approval-gated (`model/tools.ts: createTools`). A model that explains instead of editing is what the "Make this change" button exists for (`Chat.tsx: MAKE_CHANGE`). |
| Thread id is inferrable from project id | Projects have **no id**. The name is the key, and renaming orphans every external reference (`explorer.ts: PgExplorer.renameWorkspace`), exactly as `flow.deploys` is already orphaned (`deploy-history.ts: DeployRecord`). |
| This is "add two tables" | There is **no server-side user**. GitHub sign-in is stateless and memory-only. Auth is a prerequisite. |

## Decisions

### Identity

- **Better Auth in DB mode**, replacing the hand-rolled PKCE/state/cookie flow.
  Its own `FIXME(@rogaldh)` in the module header comment of `api/github-oauth.mjs` (at 2233963e) names this.
- GitHub OAuth scope widens from `""` to **`read:user user:email`** — Better
  Auth's GitHub default, and not reducible: the `email` column it fills is
  `not null unique`, so an account with a private email cannot sign in without
  `user:email`. The `scope` option appends to the default rather than
  replacing it, so it is left unset.
- Primary key is the **numeric GitHub user id**. Never the login, which is
  renameable.
- Session is Better Auth's **HttpOnly cookie**. The existing OAuth cookies are
  already scoped `Path=/api` (`features/github-oauth/server/flow-cookies.mjs: cookie, issueFlowCookies` (at 2233963e)).
- `/api/agent` stays ungated in this work. Gating it is a real access change
  for every anonymous user and gets its own PR.

### Runtime and data access

- New endpoints are **`client-v2/api/*.mjs` Vercel functions** — the only
  runtime the fork owns end to end. **The Rust build server and its MongoDB are
  untouched**, which keeps this inside the "No backend changes" principle in
  `docs/assistant-context.md` as it was meant (the *build* server).
- **Plain `pg` against a pooled connection string.** No ORM, no query builder.
  Portable across Neon / Supabase / RDS Proxy / PgBouncer, which matters because
  the target instance is client-managed and its exact flavour is unconfirmed.
- **dbmate** for migrations: plain checked-in `.sql`, applied by an explicit
  step. Never auto-run on function cold start — serverless would run it
  concurrently on every instance.

### Storage model

**Local-first write-through.** **IndexedDB** is the write-ahead log and offline
cache; Postgres is authoritative on load. One codepath signed in or out.

IndexedDB rather than `localStorage`, via the `PgFs` wrapper over lightning-fs
that already holds project code (`utils/explorer/fs.ts: PgFs._fs`). Threads are files
under `/.config/chats/<threadId>.json`, sharing the volume the code lives in —
no second database, no new dependency, and no ~5 MB origin ceiling shared with
`settings`, `wallet`, `theme` and `flow.deploys`. The cost is that reads become
asynchronous, which pushes `PgAssistant.loadThread` and the sync layer async
too.

### Conversations

- Persist the **render model** (`ChatItem[]`) only. Restored threads are
  **read-only history, not resumable sessions**.
- On restore, seed the provider with a **synthetic text-only replay**: stored
  `user` and `assistant` text replayed as plain messages, tool and approval
  items dropped. `describeProject()` already re-sends live project state every
  turn (`model/prompt.ts: describeProject`), so the model gets memory from the replay and
  current reality from the project block.
- **Patch approvals store a trimmed `before`/`after` pair**, not whole files.
  `diffLines` already trims to the changed hunk plus `CONTEXT_LINES = 3`
  (`diff.ts: CONTEXT_LINES, diffLines`), so the trimmed pair renders identically
  through the existing `Diff` component. Command approvals are small and stored
  whole.
- **Pending approvals persist as `unanswered`.** The promise that blocked the
  agent loop (`store.ts: PgAssistant.requestApproval`) cannot be resumed; a restored `pending` card
  would spin forever. It is a status of its own rather than `denied`, which
  would record a refusal the user never made -- the session ended under the
  card. It renders as `NOT ANSWERED` and reads "not applied", so nothing
  claims the patch landed.
- **The model's reasoning is not stored, because it is never shown.** The
  question was open on the assumption that reasoning was rendered and then
  dropped. It is not: the Anthropic backend runs with `thinking: { type:
  "adaptive" }` (`model/anthropic.ts: createAnthropicProvider` (at 79713558)), but the panel turns that into a
  three-dot working indicator (`Component/Chat.tsx: Chat`) and `ChatItem` has no
  reasoning kind at all. A restored thread therefore loses nothing a live one
  showed, and storing reasoning would mean first deciding to render it.
- **A device that truncates says so.** `MAX_MESSAGES_PER_THREAD` applies to
  the local file only -- the server keeps every message -- so the loss is this
  device's. Past the cap the first stored item is a `notice` with the stable
  id `truncated:<threadId>`, which renders through the existing `notice` kind
  and is filtered out of the upload (`chat-sync.ts`). Without it a long thread
  comes back shortened with nothing to say so, which is the one way a restored
  thread can mislead: it looks complete.
- Every item gets a **client-minted UUID and a `createdAt`** at creation,
  replacing `let nextId = 0; const makeId = () => \`i${++nextId}\`` (`store.ts: makeId`),
  which collides across reloads and devices. This makes the login dump
  `INSERT ... ON CONFLICT (id) DO NOTHING` — idempotent, so "dump exactly once"
  stops being a rule anyone has to enforce.
- Local layout: **one file per thread**, at `/.config/chats/<threadId>.json` in
  the same IndexedDB volume as project code. **200 messages per thread**, oldest
  dropped first. No global byte budget and no cross-thread eviction: that
  machinery existed only to survive the `localStorage` ceiling, and IndexedDB's
  origin quota is hundreds of megabytes. A failed write is swallowed rather than
  thrown — the thread is still rendered from memory, and the next change
  retries.
- Sync: **one row per message**, batched at **end of turn** (the existing
  `status -> "idle"` transition). Ordering by `createdAt` with the UUID as
  tiebreaker — not a per-thread `seq`, which would need a round trip to
  allocate and breaks under concurrent offline appends.
- Threading is **universal** — fully functional signed out. The server is a
  sync target, not a prerequisite.
- On sign-out, local chat is cleared **only after a successful final sync**. On
  failure it is kept and retried at next sign-in.

### Code

- Unit: **whole-workspace snapshot**, debounced, upserted.
- Contents: user files, `.workspace/tutorial-storage.json`, `.tutorial.json`,
  and `.workspace/program-info.json` **including the `kp` secret key**.
  Accepted deliberately: this is a playground, not a production key custodian.
  It is disclosed in the UI.
- **`.workspace/metadata.json` is excluded** — as built, against this spec's
  original list. It holds the open tabs and cursor positions and is rewritten
  every time a project is opened, so syncing it would make merely *looking* at
  a project a change the other device has to reconcile, and two idle browsers
  would trade conflicts over where the caret was
  (`features/persistence/model/snapshot.ts`).
- Conflict: **never merge, never guess, ask only when both copies hold work.**
  See "Reconciling a device with the account" below; this is the part that
  changed most between spec and build.
- Local projects are handed over **automatically**, not behind an import
  prompt. The prompt was there because import can create duplicates; keying on
  a stable workspace id rather than a name removed that risk, and an opt-in
  step contradicted the promise that everything is saved. Name collisions still
  suffix (`my-program (imported)`).

### Reconciling a device with the account

Not in the original spec — it replaced "last-write-wins on `updated_at`, plus a
banner", which could not be implemented safely. The reason is worth recording:

A client that compares only "local differs from the server" cannot tell a copy
that is **behind** (the other device did work → take the server's) from one that
is **ahead** (the last push failed → taking the server's destroys an afternoon).
The first build resolved that ambiguity by always assuming "behind", because the
information needed to tell them apart was not written down anywhere — the
tokens lived in module-level `Map`s that died with the page.

So the device keeps a **sync mark** per project per account, persisted in the
same IndexedDB volume as the code: the hash of the snapshot the server last
accepted, the name it was stored under, the row's `updated_at` at that moment,
and a `dirty` hint. Per account because a tutorial's id is derived from its name
and so is identical across accounts.

The name is in there because not everything worth uploading changes the
snapshot — a rename sends a new `name` under identical bytes. And `dirty` is
strictly a hint that says "re-hash this one rather than trusting the cheap
path": it is set by any write at all, including the several that happen on every
load, so letting it decide anything meant a device that had done nothing read as
having unsaved work.

The mark carries **two** hashes, because "does this device hold work" and "is an
upload worth making" turn out to be different questions. The three workspace
files travel with the project but nobody types them — the keypair file is
rewritten every time a workspace opens — so a device that has just taken another
device's copy differs from it within a second through nothing anyone did.
Deciding cleanliness on the full snapshot made the *second* exchange of an
ordinary back-and-forth (they edit, I pick it up, they edit again) read as a
genuine divergence and ask the user to choose between two copies differing by a
file neither of them wrote. So cleanliness is decided on the user's files
(`contentHash`) and the generated ones ride along on the next upload (`hash`).

Reconcile runs on sign-in, on load, when a backgrounded tab returns, and when a
project is opened — and it is **not re-entrant**, because taking another
device's copy re-opens the workspace, which is itself an "a project was opened"
event.

Reconcile then has two independent questions and four answers:

|           | server unchanged | server moved |
| --------- | ---------------- | ------------ |
| **clean** | nothing          | take server  |
| **dirty** | push             | **ask**      |

Only the bottom-right cell involves the user. Deletes take the same shape: a
mark with no server row means "deleted on another device" (the list endpoint
filters tombstones out, so absence alone is ambiguous) — finished silently when
the local copy is clean, asked when it is not.

The server's compare-and-swap on `updated_at` stays, demoted from the primary
mechanism to a backstop for the race between deciding and writing. When it
refuses, the client **stops pushing that project** and raises the banner, rather
than retrying a swap that can never match again.

### Tabs

Not in the original spec. One person can still have more than one writer open —
a second tab, or a laptop left open at home. `PgExplorer` is backed by
IndexedDB, which tabs share, but the *current* workspace is held in memory per
tab, so a tab backgrounded for a day holds files that have since moved on and
uploads them the moment anything nudges it.

Two rules: a tab only pushes while it is visible, and a tab that has just become
visible reconciles before it is allowed to push again. The pending upload is
flushed on the way out (`visibilitychange` → `hidden`), where the document is
still alive and an ordinary fetch completes — `beforeunload` is too late and
`keepalive`/`sendBeacon` cap the body at ~64 KB against a 4 MB request-body limit
(`MAX_PROJECT_BODY_BYTES`, under Vercel's 4.5 MB request cap).

### Identity and lifecycle of projects

- `/.config/workspaces.json` extends `{ allNames, currentName }` to
  `{ workspaces: [{ id, name }], currentId }`, with a **read-time migration**
  minting UUIDs for existing users — the same shape of versioned migration the
  codebase already uses (`utils/settings.ts: migrate, migrateLegacy`, `utils/theme/theme.ts: PgTheme._MIGRATION_KEY, PgTheme.set` (at 2233963e)).
- **Directories stay named by name.** The id is a sidecar. This avoids a
  filesystem migration across every user's IndexedDB.
- **Tutorials get deterministic ids** (`tut:<kebab-slug>`) so the same tutorial
  converges on one thread across devices instead of forking. A tutorial *is* a
  workspace named after the tutorial (`utils/tutorial/tutorial.ts: PgTutorial.start, PgTutorial.isWorkspaceTutorial`).
- Conversations get their **own UUID primary key** with a nullable project
  reference. **Several threads may share a project**: the index on
  `(user_id, project_id)` is deliberately *not* unique, and the table carries
  `title` and `deleted_at` for a thread picker. Only one thread is created for
  now and the UI comes separately — but the shape is settled now, because
  adding it later would mean migrating live rows.
- The client's rule is a **convention, not a constraint**: one thread per
  project, opening the most recently updated. The cost of no unique index is
  that a concurrent find-or-create can race into two threads; that is
  survivable (both are real conversations, newest wins the default) where
  dropping a unique constraint against live data would not be.
- **A project is identified by `(user_id, id)`, never by `id` alone.** A derived
  tutorial id is deterministic across *users* as well as devices, so every user
  who starts Hello Anchor produces the same `tut:hello-anchor`. Under a global
  primary key the second user to open any tutorial would collide with the
  first — and an `on conflict do nothing` insert would silently attach them to
  a row someone else owns. Uniqueness of a thread is therefore
  `(user_id, project_id)` too.
- Deleting a project **cascade-deletes** its conversation.
- Deletes are **tombstoned** (`deleted_at`) so another device's sync sees
  "deleted" rather than "missing" and does not resurrect the row.
- Renames **propagate as an explicit sync operation** on the existing
  `onDidRenameWorkspace` event (`explorer.ts: PgExplorer.onDidRenameWorkspace`).
- Import collisions create a **second row with a suffixed name**
  (`my-program (imported)`). Never merge, never overwrite.

### UI

Wire to the **existing** `ProjectSwitcher` (`views/flow/header/ProjectSwitcher.tsx`).
Switching project swaps the thread. **No conversation browser** — that is what
the conversation's own UUID PK keeps cheap later.

### Shipping

- Behind a `GET /api/sync -> { enabled }` probe, matching the existing
  `/api/agent` capability-probe idiom (`api/agent.mjs: handler`).
- **Default off in production** until a `SELECT 1` from a deployed preview
  passes.
- `postgres:16` added to `compose.yaml` for local dev and to `client-v2.yml`
  for CI; API routes integration-tested against a real Postgres.
- Signed-in E2E sync tests are **out of scope initially** — a known, stated
  gap. Real GitHub OAuth in CI flakes, and a test-only auth bypass is a new
  attack surface.
- Branch off `master`, PR against `master`, Conventional Commits with a
  `(client-v2)` scope.

## Risks

- **Reachability is a potential hard blocker.** If the client's Postgres sits
  behind a VPC or IP allowlist, Vercel functions cannot reach it — their egress
  IPs are dynamic without a static-egress plan. Validated first, by design.
- Program keypairs will live in managed Postgres. Accepted; disclosed.
- Restored threads are not genuinely resumable.
- `/api/agent` remains an open endpoint that can spend the configured model key
  (module header comment of `api/agent.mjs`). Tracked separately.

## Descope line

Client-side threading (local persistence + switcher wiring, no backend, no
auth, no Postgres) delivers gaps 1 and 3 on its own. The expensive half of this
work is **cross-device**, not **persistence**.
