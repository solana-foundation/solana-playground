# Persistent conversations and code — design spec

Status: agreed, 2026-09-15. Implements cross-device persistence for the
client-v2 assistant panel and project code.

## Problem

Three gaps in the current client-v2:

1. Conversations are not tied to a project or tutorial, and do not survive a
   reload. Chat is in-memory only by design (`store.ts:115-121`).
2. Code lives only in this browser. Signing in "buys identity and nothing
   else" — the in-repo note at `features/github-oauth/model/github-auth.ts:50-68`
   states the problem and names this work as the fix.
3. There is no way to move between conversation threads.

## Premise corrections

Facts established while designing, which contradict the original brief:

| Assumed | Actual |
| --- | --- |
| Code is in `localStorage` | Code is in **IndexedDB** via lightning-fs (`utils/explorer/fs.ts:7`). The `"explorer"` localStorage key is a dead legacy migration (`explorer.ts:1186-1208`). |
| Chat can follow "how code does it" | No such precedent. Chat has never been persisted. |
| There are no approval items | `write_file`, `build` and `deploy` are all approval-gated (`model/tools.ts:126-131,157,195`). A model that explains instead of editing is what the "Make this change" button exists for (`Chat.tsx:44-49`). |
| Thread id is inferrable from project id | Projects have **no id**. The name is the key, and renaming orphans every external reference (`explorer.ts:534-555`), exactly as `flow.deploys` is already orphaned (`deploy-history.ts:11-13`). |
| This is "add two tables" | There is **no server-side user**. GitHub sign-in is stateless and memory-only. Auth is a prerequisite. |

## Decisions

### Identity

- **Better Auth in DB mode**, replacing the hand-rolled PKCE/state/cookie flow.
  Its own `FIXME(@rogaldh)` at `api/github-oauth.mjs:16-20` names this.
- GitHub OAuth scope widens from `""` to **`read:user user:email`** — Better
  Auth's GitHub default, and not reducible: the `email` column it fills is
  `not null unique`, so an account with a private email cannot sign in without
  `user:email`. The `scope` option appends to the default rather than
  replacing it, so it is left unset.
- Primary key is the **numeric GitHub user id**. Never the login, which is
  renameable.
- Session is Better Auth's **HttpOnly cookie**. The existing OAuth cookies are
  already scoped `Path=/api` (`features/github-oauth/server/flow-cookies.mjs:10-31`).
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
that already holds project code (`utils/explorer/fs.ts:7`). Threads are files
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
  turn (`model/prompt.ts:72-117`), so the model gets memory from the replay and
  current reality from the project block.
- **Patch approvals store a trimmed `before`/`after` pair**, not whole files.
  `diffLines` already trims to the changed hunk plus `CONTEXT_LINES = 3`
  (`Component/diff.ts:10,36-84`), so the trimmed pair renders identically
  through the existing `Diff` component. Command approvals are small and stored
  whole.
- **Pending approvals persist as `denied`.** The promise that blocked the agent
  loop (`store.ts:417`) cannot be resumed; a restored `pending` card would spin
  forever.
- Every item gets a **client-minted UUID and a `createdAt`** at creation,
  replacing `let nextId = 0; const makeId = () => \`i${++nextId}\`` (`store.ts:103-104`),
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
- Contents: user files, `.workspace/metadata.json`,
  `.workspace/tutorial-storage.json`, `.tutorial.json`, and
  `.workspace/program-info.json` **including the `kp` secret key**. Accepted
  deliberately: this is a playground, not a production key custodian. It is
  disclosed in the UI.
- Conflict: **last-write-wins on `updated_at`**, except that a client whose
  loaded `updated_at` is stale **does not autosave** — it shows a banner.
  Never merge. No version history.
- First sign-in shows an **explicit import prompt** for local projects, because
  import can create duplicates. Chat sync is automatic, because UUIDs make it
  idempotent.

### Identity and lifecycle of projects

- `/.config/workspaces.json` extends `{ allNames, currentName }` to
  `{ workspaces: [{ id, name }], currentId }`, with a **read-time migration**
  minting UUIDs for existing users — the same shape of versioned migration the
  codebase already uses (`utils/settings.ts:73-188`, `utils/theme/theme.ts:31-117`).
- **Directories stay named by name.** The id is a sidecar. This avoids a
  filesystem migration across every user's IndexedDB.
- **Tutorials get deterministic ids** (`tut:<kebab-slug>`) so the same tutorial
  converges on one thread across devices instead of forking. A tutorial *is* a
  workspace named after the tutorial (`utils/tutorial/tutorial.ts:228,134-136`).
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
  `onDidChangeWorkspace` event (`explorer.ts:977-1099`).
- Import collisions create a **second row with a suffixed name**
  (`my-program (imported)`). Never merge, never overwrite.

### UI

Wire to the **existing** `ProjectSwitcher` (`views/flow/header/ProjectSwitcher.tsx`).
Switching project swaps the thread. **No conversation browser** — that is what
the conversation's own UUID PK keeps cheap later.

### Shipping

- Behind a `GET /api/sync -> { enabled }` probe, matching the existing
  `/api/agent` capability-probe idiom (`api/agent.mjs:100-120`).
- **Default off in production** until a `SELECT 1` from a deployed preview
  passes.
- `postgres:16` added to `compose.yaml` for local dev and to `client-v2.yml`
  for CI; API routes integration-tested against a real Postgres.
- Signed-in E2E sync tests are **out of scope initially** — a known, stated
  gap. Real GitHub OAuth in CI flakes, and a test-only auth bypass is a new
  attack surface.
- Branch off `master-2.0`, PR against `master-2.0`, Conventional Commits with a
  `(client-v2)` scope.

## Risks

- **Reachability is a potential hard blocker.** If the client's Postgres sits
  behind a VPC or IP allowlist, Vercel functions cannot reach it — their egress
  IPs are dynamic without a static-egress plan. Validated first, by design.
- Program keypairs will live in managed Postgres. Accepted; disclosed.
- Restored threads are not genuinely resumable.
- `/api/agent` remains an open endpoint that can spend the configured model key
  (`api/agent.mjs:12-14`). Tracked separately.

## Descope line

Client-side threading (local persistence + switcher wiring, no backend, no
auth, no Postgres) delivers gaps 1 and 3 on its own. The expensive half of this
work is **cross-device**, not **persistence**.
