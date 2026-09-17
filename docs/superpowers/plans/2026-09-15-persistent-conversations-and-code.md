# Persistent Conversations and Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make client-v2 assistant conversations and project code persist per user in Postgres, threaded by project/tutorial, so they survive reloads and follow the user across devices.

**Architecture:** Local-first write-through. IndexedDB holds both chat threads (one file per thread, under `/.config/chats/`) and project code, in the one lightning-fs volume the app already has; that local copy is the write-ahead log. Postgres is authoritative on load and is reached through new `client-v2/api/*.mjs` Vercel functions using plain `pg`. Identity comes from Better Auth in DB mode over GitHub OAuth. The Rust build server and its MongoDB are untouched.

**Tech Stack:** React 17 + TypeScript 5.0.4 (craco/CRA), plain ESM Node 22 serverless functions, `pg`, `better-auth`, `dbmate`, Jest (`craco test`) for `src/`, `node --test` for `.mjs`.

**Spec:** `docs/persistent-conversations-spec.md`

## Progress

**All 15 tasks are implemented.** What remains is verification that needs a
human or a deployment: CI has never actually run (Step 2 needs a push), the
two-browser check has not passed, and the deployed-preview reachability check
from Task 1 has never been run.

| # | Task | State |
| --- | --- | --- |
| 1 | Postgres connection + `/api/sync` probe | done |
| 2 | dbmate scaffold + nested API routes | done |
| 3 | Better Auth server, schema, `/api/auth` | done |
| 4 | `PgSession` | done |
| 4b | UI sign-in routed through Better Auth | done, verified against real GitHub |
| 4c | Popup sign-in, auth consolidated into `features/auth` | done |
| 5 | `projects` / `conversations` / `messages` schema | done |
| 6 | Chat item uuids + timestamps | done |
| 7 | Stable workspace ids + read-time migration | done, e2e covers the upgrade |
| 8 | Chat codec (trimmed patches) | done |
| 9 | Local thread store (IndexedDB) | done |
| 10 | Threads follow the project switcher | done, e2e in a real browser |
| 11 | `/api/conversations` | done, live dev-server curl not run |
| 12 | `/api/projects` | done; schema fix + `PUT` contract change, see below |
| 13 | Client chat sync | done; Step 8 two-browser check not run |
| 14 | Client code snapshot sync | done |
| 15 | CI, docs, assistant context | done; CI unrun until pushed |

**Two schema decisions were made after the tasks below were written, and the SQL
in Tasks 11 and 12 has been corrected to match. Read those notes before
implementing them:**

1. A project is keyed by **`(user_id, id)`**, not `id` alone. Tutorial ids are
   derived, so every user who starts Hello Anchor produces the same
   `tut:hello-anchor` — a global key would collide across users.
2. **Several conversations may share a project.** The index on
   `(user_id, project_id)` is deliberately not unique, and `conversations`
   carries `title` and `deleted_at`. The client keeps one thread per project as
   a convention; the UI for picking between them is a separate task.

**A third schema decision was made while implementing Task 12.** Every
timestamp in our migration is now `timestamptz(3)`, not bare `timestamptz`.
`projects.updated_at` is handed to a client as the token it echoes back to
prove its write is not built on a stale read; Postgres stores microseconds and
`Date#toISOString` emits milliseconds, so at full precision that token could
never equal the stored value and every optimistic write reported a conflict
with itself. The migration was edited in place, per the pre-deploy rule, and
`db/schema.sql` regenerated.

Note that Task 12's test as written would not have caught this: the conflict
branch returns `{conflict: true, updatedAt}`, so `assert.ok(second.updatedAt)`
passes either way. The suite now also asserts `second.conflict !== true`.

**Task 12's `PUT` contract differs from the step below, after review.** The
step's `saveProject` overwrote unconditionally whenever `baseUpdatedAt` was
absent, so any client could bypass the concurrency check by simply not sending
a token. There are now three explicit ways in:

- `baseUpdatedAt` -- compare-and-swap, as before.
- neither -- **create-only**. An existing row comes back as a conflict rather
  than being overwritten, which is also what stops a device that never saw a
  delete from resurrecting a tombstone.
- `force: true` -- unconditional overwrite that un-tombstones. This is the
  "keep my copy" a user picks *after* being shown the conflict.

The conflict path is also a single statement now. It was an `update` followed
by a separate `getProject`, so the token handed back with a conflict could
already be stale by the time the client retried with it.

Tasks 13 and 14 consume this contract: a first push from a fresh device must
be prepared for a 409 and pull before retrying, rather than assuming its write
lands.

**Task 13 Step 7 was inverted, to avoid a cycle between two slices.** As
written it had `features/auth`'s `session.ts` import `PgChatSync` from
`features/persistence`, while `chat-sync.ts` imports `PgSession` from
`features/auth` -- circular, and the build's circular-dependency plugin fails
on that. Instead `PgSession.setOnSignOut(hook)` takes a callback, and the
`session` effect wires the two slices together in the effect layer, which is
allowed to know about both. Sign-in push is driven from the same effect through
the existing `onDidChange`.

Step 6's pull also moved from `Chat.tsx` to `effects/chat-thread`, where Task 10
actually put the thread lifecycle. The panel is not always mounted, so opening a
thread must not depend on anyone looking at it -- the same reason Task 10 gave.

**Known gap, not yet addressed:** the sign-in dump pushes every local thread to
whoever just signed in. If user A's session expires without a sign-out and user
B signs in on the same browser, A's local threads are uploaded to B's account.
Sign-out clears local storage, so this only bites on an expiry, but it wants a
decision in Task 14 or 15 -- most likely stamping local threads with the user
id that wrote them.

**Task 14 was incomplete as written, and the gaps were filled.** Its
Interfaces section promised `PgProjectSync.pull(id)` and `importLocal()`, but no
step implemented either -- and without them a project never reaches a second
browser, which is the point of the task. Added:

- `PgProjectSync.list()` and `PgProjectSync.fetch(id)`, the latter recording the
  server's token so the next push is a compare-and-swap rather than a blind
  write.
- `model/project-restore.ts`, which creates local workspaces for server
  projects this browser has never seen. Matching is by **id, not name** -- and
  that needed `PgWorkspace.create(name, id?)` and `PgExplorer.createWorkspace`
  to accept an existing id, because a minted id would differ on every device
  and the same project would never converge. Additive only: nothing local is
  modified or deleted.
- Restore runs on sign-in from the session effect, after the chat push.

Two further corrections to the step text:

- **Step 10's `PgExplorer.onDidChangeItem` does not exist, and neither does any
  equivalent.** The explorer emitted events for create/rename/delete and for
  workspace lifecycle, but nothing for a file's *contents* changing, so nothing
  could know the workspace had gone stale. Added `ON_DID_SAVE_FILE`, dispatched
  from `saveFileToState` -- that is what `getAllFiles` reads, so a listener is
  guaranteed to see the new content. The debounced push lives in a new
  app-level effect, `effects/project-sync`, for the same reason `chatThread` is
  one.
- `snapshot.ts` imports `PgExplorer` from `utils/explorer/explorer`, not the
  `utils` barrel: the barrel reaches `settings.ts`, which reads a
  webpack-defined global that does not exist under jest, and importing it makes
  the module untestable.

**A regression was introduced and fixed while wiring restore up.** Auto-restore
on sign-in called `PgExplorer.createWorkspace`, which switches to what it
creates -- and a workspace switch is not private: `routes/tutorials` listens for
it and calls `PgRouter.navigate()` when the new workspace is not the tutorial,
which navigates the user out of their lesson, and `chatThread` then calls
`closeThread()` and empties the panel. A correct `pull` could therefore fetch a
conversation, write it, and still leave a blank panel a moment later.

The first attempt at a fix gated restore behind a confirmation modal. That was
wrong, and the repo owner rejected it: the feature *is* "my work resumes on the
second device", so it has to run on refresh, unattended. A prompt on every load
is not sync.

The actual fix removes the disruption rather than asking permission for it.
`PgExplorer.importWorkspace(name, {id, files})` writes the files and registers
the workspace **without making it current** -- so nothing navigates, no lesson
is left, and no conversation is closed. `PgWorkspace.add(name, id)` is the
state-level half; `create` still switches, which is right when the user asked
for a new project and wrong when one arrives from elsewhere.

With that, `restoreMissingProjects()` runs silently on every load. Note the
switcher had to learn a second event: it re-rendered only on
`onDidSwitchWorkspace`, and an imported project deliberately causes no switch.

Step 11's manual verification has not been run.

**TLS is required by default, which Task 1 did not specify.** `getPool` now
passes `ssl: { rejectUnauthorized: true }`. node-postgres connects in the clear
whenever the URL mentions no `sslmode`, where dbmate refuses -- so the same URL
a migration rejected would have been used by the app to send credentials in
plaintext, silently, and a production URL pasted from a provider's dashboard
rarely mentions the flag.

An `sslmode` in the connection string overrides the pool config in both
directions (verified against a real server), so `?sslmode=disable` is how the
local and CI containers -- which serve no TLS at all -- opt out. That makes the
CI URL's `sslmode=disable` an explicit opt-out rather than a workaround for
dbmate's stricter default.

**OPEN BUG, deferred to the end-to-end pass after Task 15.** With two browsers
signed in as the same user, both on a started `tut:hello-anchor`, messages from
both reach Postgres under one conversation -- but **neither browser displays any
history**, its own included. Push, auth and the POST route are therefore fine.

Ruled out by experiment, so do not re-investigate:

- Not engine-specific and not a storage problem. `e2e/thread-restore.e2e.spec.ts`
  (added while debugging this) shows a thread is written *and restored into the
  panel* after a reload, for a project and for a tutorial, signed out, in both
  Chromium and WebKit.
- Not `closeThread` overwriting storage: it nulls `_threadId` before emitting
  and uses `_emitOnly`, which does not persist.
- Opening a tutorial from the gallery does not create a workspace -- START does.
  Before START there is no workspace id, so `threadId` is null and nothing
  persists at all. That is worth knowing but is not this bug; the reporter had
  pressed START.

The untested difference is the **signed-in `pull`**, which is the only path that
rewrites local storage (`merge` -> `PgChatStorage.write` -> `loadThread(force)`).
Both `PgChatStorage.read` and `write` swallow their failures, so a broken write
there is indistinguishable from an empty thread. Start by making those failures
visible.

Separately, WebKit fails the *project* restore case while passing the tutorial
one. Unexplained, parked, and not on the path to this bug.

Still outstanding from Task 1: **Step 13, the deployed-preview reachability
check**, has never been run. Everything works against local Docker Postgres.

---

## Global Constraints

- Node `^22.20.0`, yarn 1.x. All commands run from `client-v2/`.
- `../wasm/stub-packages.sh` must have been run before `yarn install`.
- Branch off `master-2.0`; PR against `master-2.0`. Conventional Commits with a `(client-v2)` scope.
- **Commits are the repo owner's to run, never the agent's.** Every "Commit" step below means: stop, report what is ready, and hand over the staging and commit commands. Do not run `git add`, `git commit`, `git push`, or any other write git operation without being asked for it in that same message. Read-only git (`status`, `diff`, `log`) is fine.
- Commit signing is on (`commit.gpgsign = true`, SSH key). A commit fails without the key unlocked, which is another reason the owner runs it.
- Every commit message ends with the trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- `yarn check-format` gates CI and covers `src/` and `api/`. Run `yarn format` before every commit.
- `api/*.mjs` and `src/features/**/server/*.mjs` are **plain ESM, outside the TypeScript build** (`tsconfig.json` includes `src` only) and use raw `node:http` req/res so one function runs under craco dev, `vercel dev`, and Vercel. Follow `api/health.mjs`.
- **Never import `pg` or any server `.mjs` from `src/**/*.ts(x)`.** It would enter the webpack graph and break the browser build.
- Postgres is reached only through a **pooled connection string** in `DATABASE_URL`. No Neon-specific driver.
- Migrations are checked in and applied by an explicit step. **Never auto-run migrations from a function.**
- **Until this branch ships, the schema is exactly two migrations**: one for Better Auth's tables, one for ours. Nothing here has been deployed, so a later task that needs another column edits the migration that creates the table — it never adds an `ALTER TABLE` against a table an earlier migration in this same branch created. The history should read as the schema, not as the order things were discovered in. After the first deploy the rule inverts: every change is then a new migration, because a released schema has states other people's databases are already in.
- `SYNC_ENABLED` defaults to unset (disabled) in production until Task 1 passes on a deployed preview.
- The single feature branch is `saving-chats-history` (already checked out). One PR, per the delivery decision.

---

### Task 1: Postgres connectivity and the `/api/sync` probe

De-risks the one thing that can invalidate the whole plan: whether a Vercel function can reach the client's Postgres at all.

**Files:**
- Create: `client-v2/src/features/persistence/server/db.mjs`
- Create: `client-v2/src/features/persistence/server/db.test.mjs`
- Create: `client-v2/api/sync.mjs`
- Create: `client-v2/api/sync.test.mjs`
- Modify: `client-v2/package.json` (add `pg` dependency, add `test-api` script)
- Modify: `compose.yaml` (add a `postgres:16` service)
- Modify: `client-v2/.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `getPool(): import("pg").Pool | null`
  - `query(text: string, params?: unknown[]): Promise<import("pg").QueryResult>`
  - `isConfigured(): boolean`
  - `isEnabled(): boolean`
  - `GET /api/sync` → `200 {enabled: boolean, db: "ok" | "unreachable" | "unconfigured"}`

- [ ] **Step 1: Add the dependency and the API test script**

In `client-v2/package.json`, add `"pg": "^8.13.1"` to `dependencies` (alphabetical, after `"pako"`), and add to `scripts`:

```json
"test-api": "node --test \"api/**/*.test.mjs\" \"src/features/**/server/**/*.test.mjs\""
```

Then run `yarn install`.

- [ ] **Step 2: Add Postgres to compose and env example**

In `compose.yaml`, add under `services:` (alongside the existing `db:` Mongo service — both are kept; Mongo belongs to the Rust server and is not touched):

```yaml
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: solpg
      POSTGRES_PASSWORD: solpg
      POSTGRES_DB: solpg
    ports:
      - ${PG_POSTGRES_PORT:-5432}:5432
    volumes:
      - postgres:/var/lib/postgresql/data
    profiles:
      - dev
      - prod
      - v2
      - v2-prod
```

and add `postgres:` to the top-level `volumes:` block next to `mongodb:`.

In `client-v2/.env.example`, append:

```sh
# Postgres for conversation and project sync. Must be a POOLED connection
# string: serverless functions open a connection per invocation and will
# exhaust `max_connections` against a direct endpoint.
DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg

# Kill switch. Unset or anything but "true" disables sync and makes the panel
# behave exactly as it does today.
SYNC_ENABLED=true
```

- [ ] **Step 3: Write the failing test for the db module**

Create `client-v2/src/features/persistence/server/db.test.mjs`:

```js
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const load = async () => {
  // Fresh module per case: the pool is memoised at module scope
  const url = new URL("./db.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
};

describe("db", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.SYNC_ENABLED;
  });

  it("reports unconfigured when DATABASE_URL is absent", async () => {
    const db = await load();
    assert.equal(db.isConfigured(), false);
    assert.equal(db.getPool(), null);
  });

  it("is disabled unless SYNC_ENABLED is exactly true", async () => {
    process.env.DATABASE_URL = "postgres://x/y";
    process.env.SYNC_ENABLED = "1";
    const db = await load();
    assert.equal(db.isEnabled(), false);
  });

  it("is enabled when configured and switched on", async () => {
    process.env.DATABASE_URL = "postgres://x/y";
    process.env.SYNC_ENABLED = "true";
    const db = await load();
    assert.equal(db.isEnabled(), true);
  });

  it("rejects a query when unconfigured, rather than throwing on import", async () => {
    const db = await load();
    await assert.rejects(() => db.query("select 1"), /not configured/i);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `yarn test-api`
Expected: FAIL — `Cannot find module` for `db.mjs`.

- [ ] **Step 5: Implement the db module**

Create `client-v2/src/features/persistence/server/db.mjs`:

```js
/**
 * The one Postgres entry point for every API route.
 *
 * Plain `pg` against a pooled connection string, deliberately: the target
 * instance is client-managed and its flavour is not confirmed, so nothing
 * here may depend on a vendor driver. `max` is small because a serverless
 * platform runs many instances -- the real pooling happens in front of the
 * database, not here.
 */
import pg from "pg";

let pool = null;

/** Whether a connection string is present at all */
export const isConfigured = () => !!process.env.DATABASE_URL;

/** Whether sync should serve traffic. The kill switch is opt-in. */
export const isEnabled = () =>
  isConfigured() && process.env.SYNC_ENABLED === "true";

/**
 * The shared pool, created on first use.
 *
 * @returns the pool, or `null` when no connection string is configured
 */
export const getPool = () => {
  if (!isConfigured()) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    // Without this an idle client error takes the whole function down
    pool.on("error", () => {});
  }
  return pool;
};

/**
 * Run one statement.
 *
 * @param {string} text SQL with `$1`-style placeholders
 * @param {unknown[]} [params] bound values
 */
export const query = async (text, params) => {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not configured");
  return p.query(text, params);
};
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `yarn test-api`
Expected: PASS, 4 tests.

- [ ] **Step 7: Write the failing test for the probe route**

Create `client-v2/api/sync.test.mjs`:

```js
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import handler from "./sync.mjs";

/** Minimal stand-in for the platform's response object */
const makeRes = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(k, v) {
    this.headers[k] = v;
  },
  end(b) {
    this.body = b ?? "";
  },
});

describe("GET /api/sync", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.SYNC_ENABLED;
  });

  it("reports unconfigured without touching the database", async () => {
    const res = makeRes();
    await handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {
      enabled: false,
      db: "unconfigured",
    });
  });

  it("rejects anything but GET", async () => {
    const res = makeRes();
    await handler({ method: "POST" }, res);
    assert.equal(res.statusCode, 405);
  });
});
```

- [ ] **Step 8: Run it and confirm it fails**

Run: `yarn test-api`
Expected: FAIL — `Cannot find module './sync.mjs'`.

- [ ] **Step 9: Implement the probe route**

Create `client-v2/api/sync.mjs`:

```js
/**
 * Capability probe for conversation and project sync.
 *
 * Same shape as `/api/agent`'s discovery GET: the client asks whether the
 * feature is available and falls back to purely local behaviour when it is
 * not. That is what lets this ship dark.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
import { isConfigured, isEnabled, query } from "../src/features/persistence/server/db.mjs";

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!isConfigured()) {
    return sendJson(res, 200, { enabled: false, db: "unconfigured" });
  }

  try {
    await query("select 1");
    return sendJson(res, 200, { enabled: isEnabled(), db: "ok" });
  } catch {
    // Deliberately no detail: the message can carry the host and credentials
    return sendJson(res, 200, { enabled: false, db: "unreachable" });
  }
}
```

- [ ] **Step 10: Run the tests and confirm they pass**

Run: `yarn test-api`
Expected: PASS, 6 tests.

- [ ] **Step 11: Verify against a real database locally**

```sh
docker compose --profile v2 up -d postgres
DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg SYNC_ENABLED=true yarn dev
curl -s localhost:3000/api/sync
```

Expected: `{"enabled":true,"db":"ok"}`.

- [ ] **Step 12: Format**

```sh
yarn format
```

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/package.json client-v2/yarn.lock client-v2/api/sync.mjs client-v2/api/sync.test.mjs client-v2/src/features/persistence/server/ client-v2/.env.example compose.yaml
git commit
```

Message: `feat(client-v2): add Postgres connection and a sync capability probe`

- [ ] **Step 13: Verify reachability from a deployed preview — STOP AND REPORT**

Set `DATABASE_URL` (pooled string) and `SYNC_ENABLED=true` in the Vercel **preview** environment, push the branch, and hit `https://<preview>/api/sync`.

- `{"enabled":true,"db":"ok"}` — proceed.
- `{"enabled":false,"db":"unreachable"}` — **stop and report to the user.** This is the VPC/IP-allowlist blocker named in the spec. Vercel egress IPs are dynamic without a static-egress plan; the fix is a pooler or an allowlist change, and it is a procurement conversation, not a code change. Do not continue to Task 2 until it returns `ok`.

---

### Task 2: dbmate scaffold and nested API routes in dev

Two pieces of plumbing every later task needs. They ship together because neither has a user-visible deliverable of its own.

**Files:**
- Create: `client-v2/db/migrations/.gitkeep`
- Create: `client-v2/db/README.md`
- Modify: `client-v2/package.json` (scripts)
- Modify: `client-v2/craco.config.js:330-348` (`serveApiRoute`)
- Create: `client-v2/craco-api-route.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `yarn db-migrate` / `yarn db-rollback` / `yarn db-status`
  - Dev server resolves `/api/a/b/c` → `api/a.mjs` with `req.url` preserved, so a catch-all route works locally.

- [ ] **Step 1: Add dbmate scripts and the migrations directory**

```sh
mkdir -p client-v2/db/migrations && touch client-v2/db/migrations/.gitkeep
```

Add to `client-v2/package.json` scripts:

```json
"db-migrate": "dbmate --migrations-dir ./db/migrations --schema-file ./db/schema.sql up",
"db-rollback": "dbmate --migrations-dir ./db/migrations --schema-file ./db/schema.sql down",
"db-status": "dbmate --migrations-dir ./db/migrations --schema-file ./db/schema.sql status",
"db-new": "dbmate --migrations-dir ./db/migrations new"
```

Create `client-v2/db/README.md`:

```markdown
# Database

Plain SQL migrations, applied with [dbmate](https://github.com/amacneil/dbmate).
`dbmate` is a single binary and is **not** a package dependency — install it
locally with `brew install dbmate`, and in CI with the release download in
`.github/workflows/client-v2.yml`.

- `yarn db-new <name>` writes a new migration stub.
- `yarn db-migrate` applies pending migrations against `DATABASE_URL`.
- `db/schema.sql` is generated and checked in. Never hand-edit it.

Migrations are **never** run from a serverless function: the platform would run
them concurrently on every cold start. Apply them as an explicit deploy step.
```

- [ ] **Step 2: Write the failing test for nested route dispatch**

Create `client-v2/craco-api-route.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveApiRoute } from "./craco.config.js";

describe("resolveApiRoute", () => {
  it("resolves a flat route", () => {
    assert.deepEqual(resolveApiRoute("/health"), { name: "health" });
  });

  it("ignores the query string", () => {
    assert.deepEqual(resolveApiRoute("/sync?x=1"), { name: "sync" });
  });

  it("resolves a nested path to its first segment, for catch-all routes", () => {
    assert.deepEqual(resolveApiRoute("/auth/callback/github"), {
      name: "auth",
    });
  });

  it("refuses traversal", () => {
    assert.equal(resolveApiRoute("/../secrets"), null);
    assert.equal(resolveApiRoute("/auth/../../etc/passwd"), null);
  });

  it("refuses an empty or malformed first segment", () => {
    assert.equal(resolveApiRoute("/"), null);
    assert.equal(resolveApiRoute("/Health"), null);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `node --test client-v2/craco-api-route.test.mjs`
Expected: FAIL — `resolveApiRoute` is not exported.

- [ ] **Step 4: Extract and widen the resolver**

In `client-v2/craco.config.js`, replace the name-derivation block inside `serveApiRoute` (currently `const name = req.url.split("?")[0].replace(/^\/+/, "");` and the `/^[a-z0-9-]+$/` guard) with a call to a new exported helper, and add the helper next to `sendJson`:

```js
/**
 * Map an `/api` sub-path to the module that serves it.
 *
 * Only the first segment selects the module, so `api/auth.mjs` serves every
 * `/api/auth/...` path the way a platform catch-all does. Every segment is
 * still constrained rather than sanitised, because the value reaches
 * `import()`.
 *
 * @param {string} url the path below `/api`, query string included
 * @returns {{name: string} | null} the module to import, or `null` for 404
 */
const resolveApiRoute = (url) => {
  const segments = url.split("?")[0].split("/").filter(Boolean);
  if (!segments.length) return null;
  if (!segments.every((s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== ".." && s !== ".")) {
    return null;
  }
  const [name] = segments;
  return /^[a-z0-9-]+$/.test(name) ? { name } : null;
};

module.exports.resolveApiRoute = resolveApiRoute;
```

and inside `serveApiRoute`:

```js
  const route = resolveApiRoute(req.url);
  if (!route) {
    return sendJson(res, 404, { error: `No API route at /api${req.url}` });
  }

  try {
    const mod = await import(`./api/${route.name}.mjs`);
    await mod.default(req, res);
  } catch (e) {
```

Keep the rest of the `catch` unchanged.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test client-v2/craco-api-route.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Confirm the dev server still serves the existing routes**

```sh
yarn dev
curl -s localhost:3000/api/health
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/nope
```

Expected: the health JSON, then `404`.

- [ ] **Step 7: Format**

```sh
yarn format
```

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/db client-v2/package.json client-v2/craco.config.js client-v2/craco-api-route.test.mjs
git commit
```

Message: `chore(client-v2): add dbmate scaffolding and nested API route dispatch`

---

### Task 3: Better Auth server, schema, and the `/api/auth` catch-all

**Files:**
- Create: `client-v2/src/features/persistence/server/auth.mjs`
- Create: `client-v2/api/auth.mjs`
- Create: `client-v2/api/auth.test.mjs`
- Create: `client-v2/db/migrations/20260915000001_better_auth.sql`
- Modify: `client-v2/package.json`
- Modify: `client-v2/.env.example`

**Interfaces:**
- Consumes: `getPool` from `server/db.mjs` (Task 1); `resolveApiRoute` dispatch (Task 2).
- Produces:
  - `auth` — the Better Auth instance
  - `requireUser(req): Promise<{id: string} | null>` — resolves the session, or `null`
  - `/api/auth/*` — Better Auth's handler
  - Tables `"user"`, `"session"`, `"account"`, `"verification"`

- [ ] **Step 1: Install and read the current API surface**

```sh
yarn add better-auth
```

Then open `node_modules/better-auth/package.json` and the package README, and confirm two things before writing code, because this plan pins behaviour the library owns:

1. The Node handler entry point and its exact import path (`better-auth/node` and `toNodeHandler`, at time of writing).
2. The session-reading helper and its signature (`auth.api.getSession({ headers })`).

Already verified against `better-auth@1.7.5`, so do not re-litigate unless the installed version differs: `@better-auth/kysely-adapter` is a direct dependency and `betterAuth({ database })` takes a `pg.Pool` instance.

If anything differs, adapt the code below and say so in the report. Do not guess.

- [ ] **Step 2: Generate the auth schema as a dbmate migration**

```sh
yarn db-new better_auth
npx auth@latest generate --output ./better-auth-schema.sql
```

The CLI is `auth`, **not** `@better-auth/cli` — that package name does not resolve.

Paste the generated DDL between the `-- migrate:up` marker and a `-- migrate:down` that drops the tables in reverse dependency order, in the file `yarn db-new` created (it stamps its own timestamp; use that name). Then delete `better-auth-schema.sql` — the migration is the checked-in copy.

**Identifier quoting — every later task depends on this.** Better Auth names its
tables and columns in camelCase, and one table is a reserved word. Postgres folds
any unquoted identifier to lowercase, so `select createdAt from user` is a syntax
error on the table name and silently wrong on the column. In hand-written SQL,
always quote:

- the table: `"user"` (reserved word; `session`, `account` and `verification` are not, but quote them too for consistency)
- every camelCase column: `"emailVerified"`, `"createdAt"`, `"updatedAt"`, `"userId"`, `"expiresAt"`, `"accountId"`, `"providerId"`, `"ipAddress"`, `"userAgent"`

Lowercase single-word columns (`id`, `name`, `email`, `image`, `token`, `value`,
`scope`, `password`, `identifier`) need no quoting.

The verified core schema, from `@better-auth/core@1.7.5/dist/db/get-tables.mjs`:

| Table | Columns |
| --- | --- |
| `"user"` | `id` PK, `name`, `email` unique, `"emailVerified"` bool default false, `image` null, `"createdAt"`, `"updatedAt"` |
| `"session"` | `id`, `"expiresAt"`, `token` unique, `"createdAt"`, `"updatedAt"`, `"ipAddress"` null, `"userAgent"` null, `"userId"` → `"user"(id)` cascade |
| `"account"` | `id`, `"accountId"`, `"providerId"`, `"userId"` → `"user"(id)` cascade, `"accessToken"` null, `"refreshToken"` null, `"idToken"` null, `"accessTokenExpiresAt"` null, `"refreshTokenExpiresAt"` null, `scope` null, `password` null, `"createdAt"`, `"updatedAt"` |
| `"verification"` | `id`, `identifier`, `value`, `"expiresAt"`, `"createdAt"`, `"updatedAt"` |

Use it to review what the CLI emits; if the generated DDL disagrees, the
installed version differs from the one this was read from — trust the generator
and update this table.

**Do not run `npx auth@latest migrate`.** It auto-creates tables on the Kysely
adapter, which would put a second migration system next to dbmate against one
database, with no shared ordering — and `projects.user_id` (Task 5) has a
foreign key into `"user"`, so ordering matters. Generate once, check the SQL in,
and let dbmate be the only runner.

Better Auth's table and column names could be remapped with `modelName` /
`fields` to match this repo's snake_case, and deliberately are not: it is ~25
lines of mapping that silently misses any field a future version adds, and it
makes the upgrade diff harder to verify. Only two places in our own SQL touch
these tables — the `projects.user_id` foreign key and the test fixtures — so the
quoting cost is small and contained. The `id` column cannot be renamed in any
case (`Exclude<Keys, "id">` in `init-options.d.mts:191`).

- [ ] **Step 3: Apply it and confirm**

```sh
docker compose --profile v2 up -d postgres
DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn db-migrate
DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn db-status
```

Expected: the migration listed as applied, and `client-v2/db/schema.sql` written.

- [ ] **Step 4: Write the failing test for the auth module's guard behaviour**

Create `client-v2/api/auth.test.mjs`:

```js
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const load = async () => {
  const url = new URL("./auth.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
};

const makeRes = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(k, v) {
    this.headers[k] = v;
  },
  end(b) {
    this.body = b ?? "";
  },
});

describe("/api/auth", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  it("503s when the database is not configured, instead of crashing on import", async () => {
    const mod = await load();
    const res = makeRes();
    await mod.default({ method: "GET", url: "/auth/session", headers: {} }, res);
    assert.equal(res.statusCode, 503);
    assert.match(JSON.parse(res.body).error, /not configured/i);
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `yarn test-api`
Expected: FAIL — `Cannot find module './auth.mjs'`.

- [ ] **Step 6: Implement the auth instance and route**

Create `client-v2/src/features/persistence/server/auth.mjs`:

```js
/**
 * Better Auth in database mode, over GitHub.
 *
 * Replaces the hand-rolled PKCE/state/cookie flow in `api/github-oauth.mjs`,
 * exactly as its own FIXME anticipated. The scope widens from "" to
 * `read:user` because a stateless sign-in needed no identity of its own and a
 * persisted one does. The stable key is the numeric GitHub id -- never the
 * login, which the user can change.
 *
 * Built lazily so the module can be imported with nothing configured: the
 * probe in `/api/sync` and the dev server both need that.
 */
import { betterAuth } from "better-auth";

import { getPool } from "./db.mjs";

let instance = null;

/**
 * @returns {ReturnType<typeof betterAuth> | null} the auth instance, or
 * `null` when the database or the GitHub credentials are missing
 */
export const getAuth = () => {
  const pool = getPool();
  if (!pool) return null;
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return null;
  }
  if (!instance) {
    instance = betterAuth({
      database: pool,
      baseURL: process.env.AUTH_BASE_URL,
      secret: process.env.AUTH_SECRET,
      socialProviders: {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          scope: ["read:user"],
        },
      },
    });
  }
  return instance;
};

/**
 * Resolve the signed-in user for a request.
 *
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<{id: string} | null>} the user, or `null` when signed out
 */
export const requireUser = async (req) => {
  const auth = getAuth();
  if (!auth) return null;
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
    }
    const session = await auth.api.getSession({ headers });
    return session?.user ? { id: session.user.id } : null;
  } catch {
    return null;
  }
};
```

Create `client-v2/api/auth.mjs`:

```js
/**
 * Better Auth's catch-all. Every `/api/auth/...` path lands here.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
import { toNodeHandler } from "better-auth/node";

import { getAuth } from "../src/features/persistence/server/auth.mjs";

export default async function handler(req, res) {
  const auth = getAuth();
  if (!auth) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    return res.end(
      JSON.stringify({ error: "Authentication is not configured" })
    );
  }
  return toNodeHandler(auth)(req, res);
}
```

Append to `client-v2/.env.example`:

```sh
# Better Auth. AUTH_SECRET is any 32+ byte random string; generate with
# `openssl rand -base64 32`. AUTH_BASE_URL is the deployment origin.
AUTH_SECRET=
AUTH_BASE_URL=http://localhost:3000
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `yarn test-api`
Expected: PASS.

- [ ] **Step 8: Verify a real sign-in end to end**

Point the GitHub OAuth app's callback at `http://localhost:3000/api/auth/callback/github`, then:

```sh
DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg \
AUTH_SECRET=$(openssl rand -base64 32) AUTH_BASE_URL=http://localhost:3000 \
GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... yarn dev
```

`sign-in/social` is **POST-only** — verified against the route table; there is no
GET variant, so navigating to it in a browser correctly 404s. It answers with
`{url}` for the caller to redirect to, rather than redirecting itself.

Open `http://localhost:3000` and run this in the browser console:

```js
const r = await fetch("/api/auth/sign-in/social", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ provider: "github", callbackURL: "/" }),
});
location.href = (await r.json()).url;
```

Complete the GitHub flow, then confirm a row exists:

```sh
docker compose exec postgres psql -U solpg -d solpg -c 'select id, name from "user";'
```

Expected: one row.

- [ ] **Step 9: Format**

```sh
yarn format
```

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/package.json client-v2/yarn.lock client-v2/api/auth.mjs client-v2/api/auth.test.mjs client-v2/src/features/persistence/server/auth.mjs client-v2/db client-v2/.env.example
git commit
```

Message: `feat(client-v2): add Better Auth in database mode over GitHub`

---

### Task 4: Client adopts the Better Auth session

**Files:**
- Create: `client-v2/src/features/persistence/model/session.ts`
- Create: `client-v2/src/features/persistence/model/session.test.ts`
- Modify: `client-v2/src/features/github-oauth/model/github-auth.ts:50-68` (comment), `:90-98` (`signIn`)
- Modify: `client-v2/src/features/persistence/index.ts` (create)

**Interfaces:**
- Consumes: `/api/auth/*` (Task 3).
- Produces:
  - `PgSession.signIn(): Promise<void>` — redirects to the Better Auth GitHub flow
  - `PgSession.signOut(): Promise<void>`
  - `PgSession.get(): { id: string; name: string | null } | null`
  - `PgSession.refresh(): Promise<void>` — reads `/api/auth/get-session`
  - `PgSession.onDidChange(cb): Disposable`

- [ ] **Step 1: Write the failing test**

Create `client-v2/src/features/persistence/model/session.test.ts`:

```ts
import { PgSession } from "./session";

describe("PgSession", () => {
  afterEach(() => {
    (global.fetch as jest.Mock | undefined)?.mockReset?.();
    PgSession.reset();
  });

  it("is signed out before any refresh", () => {
    expect(PgSession.get()).toBeNull();
  });

  it("reads the user from the session endpoint", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: "u1", name: "Ada" } }),
    }) as unknown as typeof fetch;

    await PgSession.refresh();

    expect(PgSession.get()).toEqual({ id: "u1", name: "Ada" });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/get-session",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("treats a failed request as signed out rather than throwing", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline")) as
      unknown as typeof fetch;

    await PgSession.refresh();

    expect(PgSession.get()).toBeNull();
  });

  it("notifies subscribers when the user changes", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: "u1", name: null } }),
    }) as unknown as typeof fetch;
    const seen: unknown[] = [];
    const sub = PgSession.onDidChange(() => seen.push(PgSession.get()));

    await PgSession.refresh();
    sub.dispose();

    expect(seen).toEqual([{ id: "u1", name: null }]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern session`
Expected: FAIL — cannot resolve `./session`.

- [ ] **Step 3: Implement the session model**

Create `client-v2/src/features/persistence/model/session.ts`:

```ts
import type { Disposable } from "../../../utils";

/** Who is signed in, as far as our own backend is concerned */
export interface SessionUser {
  id: string;
  name: string | null;
}

/**
 * The signed-in user, from our backend rather than from GitHub.
 *
 * `GithubAuth` answers "which GitHub account is this", which is what the
 * airdrop gate wants. This answers "which row owns the synced data", which is
 * a different question with a different lifetime: the Better Auth cookie is
 * HttpOnly and survives a reload, and the GitHub token deliberately does not.
 */
export class PgSession {
  static get(): SessionUser | null {
    return PgSession._user;
  }

  /** Re-read the session cookie. Never throws; failure means signed out. */
  static async refresh() {
    let next: SessionUser | null = null;
    try {
      const response = await fetch("/api/auth/get-session", {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        const body = await response.json();
        next = body?.user
          ? { id: String(body.user.id), name: body.user.name ?? null }
          : null;
      }
    } catch {
      next = null;
    }
    PgSession._set(next);
  }

  /**
   * Start the GitHub flow.
   *
   * Two steps, not a plain navigation: `sign-in/social` is POST-only and
   * answers with the authorize URL rather than redirecting to it, so the
   * caller performs the redirect. Navigating straight at the endpoint 404s.
   *
   * @param callbackURL where GitHub returns the user once signed in
   */
  static async signIn(callbackURL = window.location.pathname) {
    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "github", callbackURL }),
    });
    if (!response.ok) throw new Error("Could not start sign-in");

    const { url } = await response.json();
    if (!url) throw new Error("Sign-in did not return a redirect");
    window.location.href = url;
  }

  static async signOut() {
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    PgSession._set(null);
  }

  static onDidChange(cb: () => void): Disposable {
    PgSession._listeners.add(cb);
    return { dispose: () => PgSession._listeners.delete(cb) };
  }

  /** Test seam: drops state without touching the network */
  static reset() {
    PgSession._user = null;
    PgSession._listeners.clear();
  }

  private static _user: SessionUser | null = null;
  private static readonly _listeners = new Set<() => void>();

  private static _set(user: SessionUser | null) {
    const same =
      PgSession._user?.id === user?.id && PgSession._user?.name === user?.name;
    if (same) return;
    PgSession._user = user;
    for (const cb of PgSession._listeners) cb();
  }
}
```

Create `client-v2/src/features/persistence/index.ts`:

```ts
export { PgSession } from "./model/session";
export type { SessionUser } from "./model/session";
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `yarn test-unit --testPathPattern session`
Expected: PASS, 4 tests.

- [ ] **Step 5: Update the stale note in `github-auth.ts`**

Replace the comment block at `client-v2/src/features/github-oauth/model/github-auth.ts:50-68` — which says sign-in "buys identity and nothing else" and that workspaces should be persisted against the GitHub identity — with a pointer to what now does that:

```ts
/**
 * The token lives in module memory only, so a reload signs the user out of
 * GitHub. That is still deliberate: the token is not isolated from project
 * code, and the empty scope is what bounds the damage.
 *
 * Durable identity is no longer this class's job. `PgSession` in
 * `features/persistence` owns the signed-in user for sync, backed by a Better
 * Auth HttpOnly cookie that does survive a reload.
 */
```

- [ ] **Step 6: Typecheck and commit**

Run: `yarn test-types && yarn test-unit --watchAll=false`
Expected: both pass.

```sh
yarn format
git add client-v2/src/features/persistence client-v2/src/features/github-oauth/model/github-auth.ts
git commit
```

Message: `feat(client-v2): read the signed-in user from the Better Auth session`

---

### Task 4b: Route the UI sign-in through Better Auth

**Added after the plan was written.** Task 4 builds `PgSession` but nothing calls
it: the header button still ran the old memory-only `GithubAuth` flow, so signing
in created no `user` row and no session. Every later task keys off
`PgSession.get()`, so without this the whole feature is inert. Found by signing
in and finding the tables empty.

**Files:**
- Modify: `client-v2/src/views/flow/header/StatusChips.tsx`
- Modify: `client-v2/src/components/Wallet/hooks/useAirdrop.tsx`
- Modify: `client-v2/src/effects/automatic-airdrop/automatic-airdrop.tsx`
- Modify: `client-v2/src/commands/airdrop/airdrop.ts`
- Create: `client-v2/src/effects/session/{session.tsx,index.ts}`
- Modify: the Task 3 Better Auth migration (add the `login` column there)
- Modify: `client-v2/src/features/persistence/{index.ts,model/session.ts}`
- Modify: `client-v2/src/features/persistence/server/auth.mjs`

**Interfaces:**
- Produces: `checkSignedIn()` replacing `checkGithubSignIn`; `SessionUser` gains
  `image` and `login`.

- [ ] **Step 1: Add the GitHub handle**

Better Auth's core `user` carries `name` and `image` but not the `@handle`, and
the profile chip renders it. Add it as an additional field rather than a second
identity: a login is renameable, so ownership still keys off `user.id`.

In `auth.mjs`, declare `user.additionalFields.login` (`{type: "string", required: false, input: false}`)
and fill it with `mapProfileToUser: (profile) => ({ login: profile.login })` on
the GitHub provider.

**Add the column to the Task 3 migration's `create table "user"`, not as a new
`ALTER TABLE`** — see Global Constraints. That migration has not shipped, so
there is no intermediate state to preserve. Roll back, edit, re-apply.

- [ ] **Step 2: Swap the header over**

In `StatusChips.tsx`, replace `GithubAuth` with `PgSession` throughout:
`useRenderOnChange(PgSession.onDidChange)`, `PgSession.get()`, `PgSession.signIn()`,
`void PgSession.signOut()`. Render `github.image` and `github.login`, both of
which are nullable now — guard the avatar, the `@handle`, and the
`github.com/<login>` link.

**The popup sign-in UX is preserved** — see Task 4c. Better Auth *returns* an
authorize URL rather than driving a redirect itself, so the caller chooses;
keep the `CancelSignIn` button and the "Signing in…" chip, wired to
`PgSession.cancelSignIn`.

- [ ] **Step 3: Move the airdrop gate**

Export `checkSignedIn()` from `features/persistence` (throws
`"Sign in with GitHub to request devnet SOL."` when `PgSession.get()` is null)
and use it in `commands/airdrop/airdrop.ts` in place of `checkGithubSignIn`.
Point `useAirdrop.tsx` and `automatic-airdrop.tsx` at `PgSession` too.

- [ ] **Step 4: Restore the session on load**

The session cookie is HttpOnly, so the app does not know it exists until it
asks — without this a reload renders signed out while the cookie is still
valid. Add `src/effects/session/session.tsx`:

```tsx
export const session = (): Disposable => {
  void PgSession.refresh();
  return { dispose: () => {} };
};
```

Effects **must return a `Disposable`** (`app/Effects/Effects.tsx:7` destructures
`dispose` from every one), hence the no-op. Add `index.ts` re-exporting it and
run `yarn generate-exports` — `effects/generated.ts` is generated from the
directory listing.

- [ ] **Step 5: Verify**

Run `yarn test-types && yarn test-unit && yarn check-format`, then sign in
through the header button and confirm a row lands:

```sh
docker compose exec postgres psql -U solpg -d solpg -c 'select id, name, login from "user";'
```

---

### Task 4c: Keep the popup sign-in, on the Better Auth backend

**Added after the plan was written.** The first cut navigated the whole page at
the authorize URL, which drops everything the app holds in memory. It does not
have to: `sign-in/social` *returns* `{url}` rather than redirecting, so the
caller decides how to open it.

The flow works because the session is a **same-origin cookie, not a token**:
Better Auth sets it during `/api/auth/callback/github`, and cookies are
per-origin rather than per-window — so by the time the popup reports back, the
opener can already read the session. **Nothing secret crosses the channel**,
which is strictly better than the legacy `result-page.mjs`, whose body carries
an access token and needs a CSP to contain it.

**Files:**
- Create: `client-v2/api/auth-complete.mjs`
- Modify: `client-v2/src/features/github-oauth/config.mjs` (new flow constants)
- Modify: `client-v2/src/features/persistence/model/session.ts`
- Modify: `client-v2/src/views/flow/header/StatusChips.tsx`

- [ ] **Step 1: Add the landing route**

`api/auth-complete.mjs` renders a page that posts to `window.opener`, falls back
to a same-origin `BroadcastChannel` when COOP severed it, and closes. **Every
branch must post and close** — a response that does neither leaves the popup
open and the app waiting until its timeout.

Echo the `nonce` query param **only when it matches `/^[0-9a-f]{1,64}$/`**. It
is interpolated into a `<script>`, so it is constrained rather than escaped; a
non-matching value is dropped entirely.

- [ ] **Step 2: Open a popup instead of navigating**

In `signIn()`, mint a nonce, pass `callbackURL: "/api/auth-complete?nonce=…"`,
then hand the returned `url` to `openPopupChannel` from
`features/github-oauth/lib/popup-channel` — reusing the COOP handling that
already exists. `accept` must require the nonce: the BroadcastChannel path
reaches every same-origin context, so the window alone cannot be the filter.

Distinguish the outcomes: a blocked popup ("Allow popups for this site") is not
the same as a cancelled one, and neither is a failed start.

Add `cancelSignIn()` so the "Signing in…" chip can stop the wait — the popup
cannot be polled once GitHub has taken it over.

- [ ] **Step 3: Verify**

`yarn test-unit`, then sign in through the header and confirm the editor is
still in place afterwards and a `"user"` row exists.

**Gotcha:** `api/*.mjs` and the `.mjs` files they import are **cached by
`import()`** and do not hot-reload. After editing one, restart the dev server or
a newly added export surfaces as "does not provide an export named X".

**Left for a follow-up:** `features/github-oauth` still holds the hand-rolled
PKCE/state/token-exchange half, now unused by the UI, plus its unit, integration
and e2e tests. Folding the session model into that slice and deleting the
hand-rolled server flow is the natural next change — it is what the
`FIXME(@rogaldh)` asked for. The two GitHub callback URLs coexist meanwhile.

---

### Task 5: Application schema

**Files:**
- Create: `client-v2/db/migrations/20260915000002_projects_and_conversations.sql`
- Modify: `client-v2/db/schema.sql` (generated)

**Interfaces:**
- Consumes: the `"user"` table from Task 3.
- Produces: tables `projects`, `conversations`, `messages`.

- [ ] **Step 1: Create the migration**

```sh
yarn db-new projects_and_conversations
```

Fill the generated file:

```sql
-- migrate:up

-- `id` is text, not uuid: tutorial projects use a deterministic
-- `tut:<slug>` id so the same tutorial converges on one row across devices,
-- while user projects use a client-minted uuid.
create table projects (
  id            text primary key,
  user_id       text not null references "user"(id) on delete cascade,
  name          text not null,
  kind          text not null default 'project',
  snapshot      jsonb,
  snapshot_hash text,
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint projects_kind_check check (kind in ('project', 'tutorial'))
);

create index projects_user_idx on projects (user_id) where deleted_at is null;

-- Names are unique per user among live rows. An import that collides is
-- suffixed by the client rather than merged.
create unique index projects_user_name_idx
  on projects (user_id, name) where deleted_at is null;

create table conversations (
  id         uuid primary key,
  user_id    text not null references "user"(id) on delete cascade,
  project_id text references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One thread per project today. Dropping this index is the whole migration
-- needed to allow several, which is why the conversation has its own key.
create unique index conversations_project_idx
  on conversations (project_id) where project_id is not null;

create table messages (
  id              uuid primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  kind            text not null,
  payload         jsonb not null,
  created_at      timestamptz not null,
  constraint messages_kind_check
    check (kind in ('user', 'assistant', 'tool', 'approval', 'error', 'notice'))
);

-- Matches the read: one thread, in order. `id` breaks ties between two
-- devices that minted the same millisecond.
create index messages_conversation_idx
  on messages (conversation_id, created_at, id);

-- migrate:down

drop table if exists messages;
drop table if exists conversations;
drop table if exists projects;
```

- [ ] **Step 2: Apply and verify**

```sh
DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn db-migrate
docker compose exec postgres psql -U solpg -d solpg -c '\d messages'
```

Expected: the table and the `messages_conversation_idx` index.

- [ ] **Step 3: Verify the rollback works**

```sh
DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn db-rollback
DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn db-migrate
```

Expected: down then up, both clean. A migration whose `down` fails is not reviewable.

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/db
git commit
```

Message: `feat(client-v2): add projects, conversations and messages schema`

---

### Task 6: Stable message ids and timestamps

**Files:**
- Create: `client-v2/src/features/persistence/model/ids.ts`
- Create: `client-v2/src/features/persistence/model/ids.test.ts`
- Modify: `client-v2/src/views/sidebar/assistant/store.ts:32-46` (`ChatItem`), `:103-104` (`makeId`), and every push site (`:305`, `:368`, `:393`, `:398`, `:403`, `requestApproval` at `:417`)
- Create: `client-v2/src/views/sidebar/assistant/store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `uuid(): string`
  - `ChatItem` gains `createdAt: string` (ISO 8601) on every variant; `id` becomes a UUID.

- [ ] **Step 1: Write the failing test for the id helper**

Create `client-v2/src/features/persistence/model/ids.test.ts`:

```ts
import { uuid } from "./ids";

describe("uuid", () => {
  it("returns an RFC 4122 v4 string", () => {
    expect(uuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, uuid));
    expect(seen.size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern ids`
Expected: FAIL — cannot resolve `./ids`.

- [ ] **Step 3: Implement the id helper**

Create `client-v2/src/features/persistence/model/ids.ts`:

```ts
/**
 * A v4 UUID.
 *
 * `crypto.randomUUID` is not used unconditionally: browserslist still claims
 * Safari 14, which has `getRandomValues` but not `randomUUID`, and this runs
 * on every message.
 */
export const uuid = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Version 4, variant 10xx
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `yarn test-unit --testPathPattern ids`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing test for stable store ids**

Create `client-v2/src/views/sidebar/assistant/store.test.ts`:

```ts
import { PgAssistant } from "./store";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("PgAssistant item identity", () => {
  beforeEach(() => PgAssistant.clear());

  it("gives every item a uuid, not a session counter", () => {
    PgAssistant.addUserMessage("hi");
    const [item] = PgAssistant.items;
    expect(item.id).toMatch(UUID_RE);
  });

  it("stamps every item with a creation time", () => {
    PgAssistant.addUserMessage("hi");
    const [item] = PgAssistant.items;
    expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
  });

  it("does not reuse ids across a clear", () => {
    PgAssistant.addUserMessage("first");
    const first = PgAssistant.items[0].id;
    PgAssistant.clear();
    PgAssistant.addUserMessage("second");
    expect(PgAssistant.items[0].id).not.toBe(first);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern assistant/store`
Expected: FAIL — `id` is `"i1"`, and `createdAt` does not exist.

- [ ] **Step 7: Make ids stable**

In `client-v2/src/views/sidebar/assistant/store.ts`:

Add the import at the top, with the other relative imports:

```ts
import { uuid } from "../../../features/persistence";
```

Replace `store.ts:103-104`:

```ts
const makeId = () => uuid();
const now = () => new Date().toISOString();
```

Add `createdAt` to the `ChatItem` union by giving every variant the field. Replace the union at `store.ts:32-46` with:

```ts
/** What every rendered item carries, whatever its kind */
interface ChatItemBase {
  id: string;
  /** ISO 8601. Orders a restored thread; the id breaks ties. */
  createdAt: string;
}

export type ChatItem =
  | (ChatItemBase & { kind: "user"; text: string })
  | (ChatItemBase & { kind: "assistant"; text: string })
  | (ChatItemBase & { kind: "tool"; label: string })
  | (ChatItemBase & {
      kind: "approval";
      request: ApprovalRequest;
      status: ApprovalStatus;
      /** Set once the tool has actually run */
      outcome?: string;
    })
  | (ChatItemBase & { kind: "error"; text: string })
  /** Something the panel did, not the model — e.g. the user stopped the turn */
  | (ChatItemBase & { kind: "notice"; text: string });
```

Then add `createdAt: now()` to every object literal pushed into `_items`. There are six push sites: `addUserMessage` (`:305`), `startAssistantMessage` (`:368`), `addToolCall` (`:393`), `addNotice` (`:398`), `addError` (`:403`), and `requestApproval` (`:417`). For example:

```ts
  static addUserMessage(text: string) {
    PgAssistant._items.push({
      kind: "user",
      id: makeId(),
      createdAt: now(),
      text,
    });
    PgAssistant._emit();
  }
```

Also update the class doc comment at `store.ts:115-121`, which currently says history is never persisted:

```ts
/**
 * Everything the panel renders.
 *
 * The API key is deliberately in memory only — see the spec at
 * `docs/persistent-conversations-spec.md`. Conversation items are not: they
 * are mirrored to IndexedDB per thread and synced to Postgres when signed
 * in.
 */
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `yarn test-unit --testPathPattern assistant/store && yarn test-types`
Expected: PASS. `test-types` catches any push site missed in Step 7 — fix each until clean.

- [ ] **Step 9: Format**

```sh
yarn format
```

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/src/features/persistence client-v2/src/views/sidebar/assistant/store.ts client-v2/src/views/sidebar/assistant/store.test.ts
git commit
```

Message: `feat(client-v2): give chat items stable uuids and timestamps`

---

### Task 7: Stable workspace ids

**Files:**
- Modify: `client-v2/src/utils/explorer/workspace.ts:3-8`, `:29-113`, `:115-120`
- Create: `client-v2/src/utils/explorer/workspace.test.ts`
- Modify: `client-v2/src/utils/explorer/explorer.ts:92-99`, `:1299-1324`
- Create: `client-v2/src/features/persistence/model/project-id.ts`
- Create: `client-v2/src/features/persistence/model/project-id.test.ts`

**Interfaces:**
- Consumes: `uuid` (Task 6); `PgCommon.toKebabFromTitle`.
- Produces:
  - `tutorialProjectId(name: string): string` — `tut:<kebab>`
  - `Workspaces` gains `workspaces: {id, name}[]` and `currentId`
  - `PgWorkspace.idOf(name): string | undefined`, `PgWorkspace.currentId`
  - `PgExplorer.currentWorkspaceId: string | undefined`

- [ ] **Step 1: Write the failing test for tutorial ids**

Create `client-v2/src/features/persistence/model/project-id.test.ts`:

```ts
import { tutorialProjectId } from "./project-id";

describe("tutorialProjectId", () => {
  it("is deterministic, so the same tutorial is one thread on every device", () => {
    expect(tutorialProjectId("Hello Anchor")).toBe("tut:hello-anchor");
    expect(tutorialProjectId("Hello Anchor")).toBe(
      tutorialProjectId("Hello Anchor")
    );
  });

  it("distinguishes different tutorials", () => {
    expect(tutorialProjectId("Hello Solana")).not.toBe(
      tutorialProjectId("Hello Anchor")
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern project-id`
Expected: FAIL — cannot resolve `./project-id`.

- [ ] **Step 3: Implement it**

Create `client-v2/src/features/persistence/model/project-id.ts`:

```ts
import { PgCommon } from "../../../utils";

/**
 * The id of the project a tutorial runs in.
 *
 * Derived rather than minted: a tutorial is the same thing on every device,
 * so two devices must agree on its id without talking to each other. Personal
 * projects get a uuid instead, because two projects that happen to share a
 * name are not the same project.
 */
export const tutorialProjectId = (name: string) =>
  `tut:${PgCommon.toKebabFromTitle(name)}`;
```

Export it from `client-v2/src/features/persistence/index.ts`:

```ts
export { uuid } from "./model/ids";
export { tutorialProjectId } from "./model/project-id";
export { PgSession } from "./model/session";
export type { SessionUser } from "./model/session";
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `yarn test-unit --testPathPattern project-id`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing test for the workspaces migration**

Create `client-v2/src/utils/explorer/workspace.test.ts`:

```ts
import { PgWorkspace } from "./workspace";

describe("PgWorkspace ids", () => {
  it("mints an id for each name when reading the legacy shape", () => {
    const ws = new PgWorkspace(
      PgWorkspace.migrate({ allNames: ["a", "b"], currentName: "b" } as never)
    );

    expect(ws.allNames).toEqual(["a", "b"]);
    expect(ws.idOf("a")).toEqual(expect.any(String));
    expect(ws.idOf("a")).not.toBe(ws.idOf("b"));
    expect(ws.currentId).toBe(ws.idOf("b"));
  });

  it("leaves an already-migrated shape untouched", () => {
    const migrated = {
      workspaces: [{ id: "keep-me", name: "a" }],
      currentId: "keep-me",
    };

    expect(PgWorkspace.migrate(migrated)).toEqual(migrated);
  });

  it("keeps the id stable across a rename", () => {
    const ws = new PgWorkspace(
      PgWorkspace.migrate({ allNames: ["a"], currentName: "a" } as never)
    );
    const before = ws.idOf("a");

    ws.rename("b");

    expect(ws.allNames).toEqual(["b"]);
    expect(ws.idOf("b")).toBe(before);
  });

  it("drops the entry on delete", () => {
    const ws = new PgWorkspace(
      PgWorkspace.migrate({ allNames: ["a", "b"], currentName: "a" } as never)
    );

    ws.delete("a");

    expect(ws.allNames).toEqual(["b"]);
    expect(ws.idOf("a")).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern explorer/workspace`
Expected: FAIL — `PgWorkspace.migrate` and `idOf` do not exist.

- [ ] **Step 7: Add ids to the workspaces model**

In `client-v2/src/utils/explorer/workspace.ts`, replace the `Workspaces` interface and add the migration and accessors. The directory on disk is still named by `name` — the id is a sidecar, so nothing in the filesystem changes.

```ts
import { tutorialProjectId, uuid } from "../../features/persistence";
import { PgCommon } from "../common";

/** One workspace, as recorded in the workspaces config */
export interface WorkspaceEntry {
  /** Stable across renames. `tut:<slug>` for tutorials, a uuid otherwise. */
  id: string;
  name: string;
}

interface Workspaces {
  workspaces: WorkspaceEntry[];
  /** Id of the current workspace */
  currentId?: string;
}

/** The pre-id shape, still on disk for every existing user */
interface LegacyWorkspaces {
  allNames: string[];
  currentName?: string;
}
```

Add to `PgWorkspace`, keeping `allNames`/`currentName` working so no call site outside this file has to change at once:

```ts
  get allNames() {
    return this._state.workspaces.map((w) => w.name);
  }

  get currentName() {
    return this._state.workspaces.find((w) => w.id === this._state.currentId)
      ?.name;
  }

  get currentId() {
    return this._state.currentId;
  }

  /** The stable id of a workspace, by name */
  idOf(name: string) {
    return this._state.workspaces.find((w) => w.name === name)?.id;
  }
```

Replace the mutators so they carry ids:

```ts
  setCurrentName(name: string) {
    const entry = this._state.workspaces.find((w) => w.name === name);
    if (entry) this._state.currentId = entry.id;
  }

  create(name: string) {
    if (this.allNames.includes(name)) {
      throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
    }

    const entry = { id: PgWorkspace.mintId(name), name };
    this._state.workspaces.push(entry);
    this._state.currentId = entry.id;
  }

  delete(name: string) {
    this._state.workspaces = this._state.workspaces.filter(
      (w) => w.name !== name
    );
    if (!this.currentName) this._state.currentId = undefined;
  }

  rename(newName: string) {
    if (this.allNames.includes(newName)) {
      throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
    }

    const current = this._state.workspaces.find(
      (w) => w.id === this._state.currentId
    );
    if (current) current.name = newName;
  }
```

and the statics:

```ts
  static readonly DEFAULT: Workspaces = { workspaces: [] };

  /**
   * Mint the id for a new workspace.
   *
   * A tutorial's id is derived from its name so two devices agree on it
   * without coordinating; everything else gets a uuid, because two projects
   * that share a name are not the same project.
   */
  static mintId(name: string) {
    // Imported lazily-shaped to avoid a cycle: `PgTutorial` reaches back here
    return PgWorkspace._isTutorialName(name)
      ? tutorialProjectId(name)
      : uuid();
  }

  /**
   * Bring the on-disk config forward to the id-carrying shape.
   *
   * Every existing user has the legacy shape, so this runs on read and is
   * the only place that knows the old field names.
   */
  static migrate(state: Workspaces | LegacyWorkspaces): Workspaces {
    if ("workspaces" in state) return state;

    const workspaces = (state.allNames ?? []).map((name) => ({
      id: PgWorkspace.mintId(name),
      name,
    }));
    return {
      workspaces,
      currentId: workspaces.find((w) => w.name === state.currentName)?.id,
    };
  }

  /** Set by `PgTutorial` at import time, to avoid a module cycle */
  static _isTutorialName: (name: string) => boolean = () => false;
```

In `client-v2/src/utils/tutorial/tutorial.ts`, next to `isWorkspaceTutorial`, register the predicate:

```ts
PgWorkspace._isTutorialName = (name: string) =>
  TUTORIALS.some((t) => t.name === name);
```

- [ ] **Step 8: Apply the migration on read**

In `client-v2/src/utils/explorer/explorer.ts`, in `_getWorkspaces()` (`:1299-1304`), wrap the parsed JSON:

```ts
    return new PgWorkspace(PgWorkspace.migrate(parsed));
```

and add the id accessor next to `currentWorkspaceName` (`:92-94`):

```ts
  /** Stable id of the current workspace, for syncing */
  static get currentWorkspaceId() {
    return this._workspace?.currentId;
  }
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `yarn test-unit --testPathPattern explorer/workspace && yarn test-types`
Expected: PASS, 4 tests, and a clean typecheck.

- [ ] **Step 10: Verify no existing user loses their projects**

```sh
yarn dev
```

In the browser console, before loading the app, seed the legacy shape and reload:

```js
// Simulates an existing user: write the legacy config into the workspace file
// via the app's own FS after first load, then hard-reload and confirm the
// project list is unchanged and `/.config/workspaces.json` now has ids.
```

Create two projects, reload, and confirm both appear and that the config file contains `workspaces` with ids. Then confirm a rename keeps the id.

- [ ] **Step 11: Format**

```sh
yarn format
```

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/src/utils/explorer client-v2/src/utils/tutorial/tutorial.ts client-v2/src/features/persistence
git commit
```

Message: `feat(client-v2): give workspaces stable ids that survive renames`

---

### Task 8: Chat item serialization

**Files:**
- Create: `client-v2/src/features/persistence/model/chat-codec.ts`
- Create: `client-v2/src/features/persistence/model/chat-codec.test.ts`

**Interfaces:**
- Consumes: `ChatItem`, `PatchApproval` (Task 6); `diffLines` is *not* used — the trimming is reimplemented locally so the codec does not depend on a rendering module.
- Produces:
  - `encodeItem(item: ChatItem): StoredItem`
  - `decodeItem(stored: StoredItem): ChatItem | null`
  - `encodeThread(items: readonly ChatItem[]): StoredItem[]`
  - `decodeThread(stored: unknown): ChatItem[]`
  - `trimPatch(before: string | null, after: string): {before: string | null; after: string}`

- [ ] **Step 1: Write the failing test**

Create `client-v2/src/features/persistence/model/chat-codec.test.ts`:

```ts
import { decodeThread, encodeItem, encodeThread, trimPatch } from "./chat-codec";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

const base = { id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-01-01T00:00:00.000Z" };

describe("trimPatch", () => {
  it("keeps only the changed region plus context", () => {
    const before = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 50", "line fifty");

    const trimmed = trimPatch(before, after);

    expect(trimmed.before!.split("\n").length).toBeLessThan(10);
    expect(trimmed.before).toContain("line 50");
    expect(trimmed.after).toContain("line fifty");
  });

  it("passes a new file through, since there is nothing to trim against", () => {
    expect(trimPatch(null, "a\nb")).toEqual({ before: null, after: "a\nb" });
  });

  it("is a no-op when nothing changed", () => {
    expect(trimPatch("same", "same")).toEqual({ before: "same", after: "same" });
  });
});

describe("encodeItem", () => {
  it("shrinks a patch approval to its changed region", () => {
    const before = Array.from({ length: 200 }, (_, i) => `x${i}`).join("\n");
    const item: ChatItem = {
      ...base,
      kind: "approval",
      status: "allowed",
      request: { type: "patch", path: "src/lib.rs", before, after: before.replace("x100", "y100") },
    };

    const encoded = encodeItem(item);

    expect(JSON.stringify(encoded).length).toBeLessThan(before.length / 4);
  });

  it("stores a pending approval as denied, since it can never resume", () => {
    const item: ChatItem = {
      ...base,
      kind: "approval",
      status: "pending",
      request: { type: "command", name: "build", effect: "Builds the program" },
    };

    expect(encodeItem(item)).toMatchObject({ status: "denied" });
  });

  it("stores a command approval whole", () => {
    const request = { type: "command" as const, name: "deploy" as const, effect: "Spends SOL" };
    const item: ChatItem = { ...base, kind: "approval", status: "allowed", request };

    expect(encodeItem(item)).toMatchObject({ request });
  });
});

describe("decodeThread", () => {
  it("round-trips text items", () => {
    const items: ChatItem[] = [
      { ...base, kind: "user", text: "hi" },
      { ...base, id: "22222222-2222-4222-8222-222222222222", kind: "assistant", text: "hello" },
    ];

    expect(decodeThread(encodeThread(items))).toEqual(items);
  });

  it("drops hand-edited junk rather than throwing", () => {
    expect(decodeThread([{ nonsense: true }, null, 7])).toEqual([]);
    expect(decodeThread("not an array")).toEqual([]);
    expect(decodeThread(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern chat-codec`
Expected: FAIL — cannot resolve `./chat-codec`.

- [ ] **Step 3: Implement the codec**

Create `client-v2/src/features/persistence/model/chat-codec.ts`:

```ts
import type {
  ApprovalRequest,
  ChatItem,
} from "../../../views/sidebar/assistant/store";

/** Unchanged lines kept either side of a change. Matches the renderer. */
const CONTEXT_LINES = 3;

/** One item as it is written to IndexedDB and to Postgres */
export type StoredItem = ChatItem;

/**
 * Reduce a patch to the region the card actually shows.
 *
 * The renderer already trims the common prefix and suffix to
 * `CONTEXT_LINES`, so storing the trimmed pair renders identically while
 * costing a fraction of the bytes — a full `before`/`after` pair is two whole
 * copies of the file, per edit.
 */
export const trimPatch = (before: string | null, after: string) => {
  if (before === null || before === after) return { before, after };

  const oldLines = before.split("\n");
  const newLines = after.split("\n");

  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  let fromEnd = 0;
  while (
    fromEnd < oldLines.length - start &&
    fromEnd < newLines.length - start &&
    oldLines[oldLines.length - 1 - fromEnd] ===
      newLines[newLines.length - 1 - fromEnd]
  ) {
    fromEnd++;
  }

  const from = Math.max(0, start - CONTEXT_LINES);
  const oldTo = Math.min(oldLines.length, oldLines.length - fromEnd + CONTEXT_LINES);
  const newTo = Math.min(newLines.length, newLines.length - fromEnd + CONTEXT_LINES);

  return {
    before: oldLines.slice(from, oldTo).join("\n"),
    after: newLines.slice(from, newTo).join("\n"),
  };
};

const encodeRequest = (request: ApprovalRequest): ApprovalRequest => {
  if (request.type !== "patch") return request;
  const { before, after } = trimPatch(request.before, request.after);
  return { ...request, before, after };
};

/**
 * Prepare one item for storage.
 *
 * A `pending` approval becomes `denied`: the promise that blocked the agent
 * loop is gone once the session ends, so a restored pending card would spin
 * for ever.
 */
export const encodeItem = (item: ChatItem): StoredItem => {
  if (item.kind !== "approval") return item;
  return {
    ...item,
    status: item.status === "pending" ? "denied" : item.status,
    request: encodeRequest(item.request),
  };
};

export const encodeThread = (items: readonly ChatItem[]): StoredItem[] =>
  items.map(encodeItem);

const KINDS = new Set([
  "user",
  "assistant",
  "tool",
  "approval",
  "error",
  "notice",
]);

const isStoredItem = (value: unknown): value is StoredItem => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChatItem>;
  return (
    typeof item.id === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.kind === "string" &&
    KINDS.has(item.kind)
  );
};

/**
 * Read a stored thread back.
 *
 * Tolerant by design: this JSON sits in the browser's own storage where a
 * user can edit it, and a corrupt entry must cost one item, not the whole
 * conversation.
 */
export const decodeThread = (stored: unknown): ChatItem[] =>
  Array.isArray(stored) ? stored.filter(isStoredItem) : [];

/** Read one stored item, or `null` if it is not one */
export const decodeItem = (stored: unknown): ChatItem | null =>
  isStoredItem(stored) ? stored : null;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `yarn test-unit --testPathPattern chat-codec`
Expected: PASS, 8 tests.

- [ ] **Step 5: Format**

```sh
yarn format
```

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/src/features/persistence/model/chat-codec.ts client-v2/src/features/persistence/model/chat-codec.test.ts
git commit
```

Message: `feat(client-v2): encode chat items for storage with trimmed patches`

---

### Task 9: The local thread store

Threads live in IndexedDB, in the same lightning-fs volume as project code, through the `PgFs` wrapper that already exists. No new dependency and no `localStorage` quota to fight.

**Files:**
- Create: `client-v2/src/features/persistence/model/chat-storage.ts`
- Create: `client-v2/src/features/persistence/model/chat-storage.test.ts`

**Interfaces:**
- Consumes: `encodeThread`, `decodeThread` (Task 8); `PgFs` from `utils/explorer/fs.ts`.
- Produces:
  - `PgChatStorage.read(threadId): Promise<ChatItem[]>`
  - `PgChatStorage.write(threadId, items): Promise<void>`
  - `PgChatStorage.remove(threadId): Promise<void>`
  - `PgChatStorage.threadIds(): Promise<string[]>`
  - `PgChatStorage.clear(): Promise<void>`
  - Constant `MAX_MESSAGES_PER_THREAD = 200`

- [ ] **Step 1: Write the failing test**

Create `client-v2/src/features/persistence/model/chat-storage.test.ts`:

```ts
import { MAX_MESSAGES_PER_THREAD, PgChatStorage } from "./chat-storage";
import { PgFs } from "../../../utils/explorer/fs";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

const item = (n: number): ChatItem => ({
  kind: "user",
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  createdAt: new Date(n * 1000).toISOString(),
  text: `m${n}`,
});

describe("PgChatStorage", () => {
  beforeEach(async () => {
    await PgChatStorage.clear();
  });

  it("round-trips a thread", async () => {
    await PgChatStorage.write("t1", [item(1), item(2)]);
    expect(await PgChatStorage.read("t1")).toEqual([item(1), item(2)]);
  });

  it("keeps threads apart", async () => {
    await PgChatStorage.write("t1", [item(1)]);
    await PgChatStorage.write("t2", [item(2)]);

    expect(await PgChatStorage.read("t1")).toEqual([item(1)]);
    expect(await PgChatStorage.read("t2")).toEqual([item(2)]);
  });

  it("returns an empty thread for an unknown id", async () => {
    expect(await PgChatStorage.read("nope")).toEqual([]);
  });

  it("keeps only the newest messages past the per-thread cap", async () => {
    const many = Array.from({ length: MAX_MESSAGES_PER_THREAD + 10 }, (_, i) =>
      item(i)
    );

    await PgChatStorage.write("t1", many);

    const read = await PgChatStorage.read("t1");
    expect(read).toHaveLength(MAX_MESSAGES_PER_THREAD);
    expect(read[read.length - 1]).toEqual(many[many.length - 1]);
    expect(read[0]).toEqual(many[10]);
  });

  it("lists and removes threads", async () => {
    await PgChatStorage.write("t1", [item(1)]);
    await PgChatStorage.write("t2", [item(2)]);

    expect((await PgChatStorage.threadIds()).sort()).toEqual(["t1", "t2"]);

    await PgChatStorage.remove("t1");

    expect(await PgChatStorage.threadIds()).toEqual(["t2"]);
    expect(await PgChatStorage.read("t1")).toEqual([]);
  });

  it("survives a hand-corrupted file rather than losing the panel", async () => {
    await PgChatStorage.write("t1", [item(1)]);
    await PgFs.writeFile("/.config/chats/t1.json", "{ not json");

    expect(await PgChatStorage.read("t1")).toEqual([]);
  });

  it("does not throw when the write fails", async () => {
    const spy = jest
      .spyOn(PgFs, "writeFile")
      .mockRejectedValue(new Error("quota"));

    await expect(PgChatStorage.write("t1", [item(1)])).resolves.toBeUndefined();

    spy.mockRestore();
  });

  it("clears every thread it owns", async () => {
    await PgChatStorage.write("t1", [item(1)]);
    await PgChatStorage.write("t2", [item(2)]);

    await PgChatStorage.clear();

    expect(await PgChatStorage.threadIds()).toEqual([]);
  });
});
```

Note: these tests exercise real lightning-fs, which is IndexedDB-backed and needs `fake-indexeddb` under jsdom. Add it as a dev dependency and register it in the test file if the suite reports `indexedDB is not defined`:

```sh
yarn add --dev fake-indexeddb
```

```ts
import "fake-indexeddb/auto";
```

placed as the first import of `chat-storage.test.ts`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern chat-storage`
Expected: FAIL — cannot resolve `./chat-storage`.

- [ ] **Step 3: Implement the store**

Create `client-v2/src/features/persistence/model/chat-storage.ts`:

```ts
import { decodeThread, encodeThread } from "./chat-codec";
import { PgFs } from "../../../utils/explorer/fs";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/** Where threads live, inside the volume that already holds project code */
const DIR = "/.config/chats";

/**
 * Messages kept per thread.
 *
 * Not a storage limit — IndexedDB has room for far more. It bounds what a
 * restored thread costs to render and what a first sync has to upload.
 */
export const MAX_MESSAGES_PER_THREAD = 200;

const pathOf = (threadId: string) => `${DIR}/${threadId}.json`;

/**
 * Chat threads on this device.
 *
 * IndexedDB via `PgFs`, not `localStorage`: the origin's ~5 MB of
 * `localStorage` is already shared with `settings`, `wallet`, `theme` and
 * `flow.deploys`, and a transcript with file diffs in it does not belong in
 * that budget. Living in the same volume as the code also means one store to
 * reason about, and `.config/` is already a non-workspace directory there.
 *
 * Every method swallows its failures. This is a cache in front of Postgres and
 * a convenience when signed out — losing a write must never take the panel
 * down with it.
 */
export class PgChatStorage {
  static async read(threadId: string): Promise<ChatItem[]> {
    try {
      const raw = await PgFs.readToString(pathOf(threadId));
      return decodeThread(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  static async write(threadId: string, items: readonly ChatItem[]) {
    const capped = items.slice(-MAX_MESSAGES_PER_THREAD);
    try {
      await PgFs.createDir(DIR, { createParents: true });
      await PgFs.writeFile(
        pathOf(threadId),
        JSON.stringify(encodeThread(capped))
      );
    } catch {}
  }

  static async remove(threadId: string) {
    try {
      await PgFs.removeFile(pathOf(threadId));
    } catch {}
  }

  static async threadIds(): Promise<string[]> {
    try {
      const names = await PgFs.readDir(DIR);
      return names
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length));
    } catch {
      return [];
    }
  }

  /** Drop every thread. Used on sign-out, after a successful final sync. */
  static async clear() {
    try {
      await PgFs.removeDir(DIR, { recursive: true });
    } catch {}
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `yarn test-unit --testPathPattern chat-storage`
Expected: PASS, 8 tests.

- [ ] **Step 5: Confirm chat files do not disturb the explorer**

The explorer enumerates `/` in one recovery branch (`explorer.ts:1158`) and filters with `isItemNameValid`. Chat files sit under the existing `/.config/`, so they add no root entry — but verify rather than assume:

```sh
yarn dev
```

Create two projects, send a message in each, then reload and confirm both projects still list and open. In the browser's Application panel, confirm `/.config/chats/` holds one file per thread.

- [ ] **Step 6: Format**

```sh
yarn format
```

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/package.json client-v2/yarn.lock client-v2/src/features/persistence/model/chat-storage.ts client-v2/src/features/persistence/model/chat-storage.test.ts
git commit
```

Message: `feat(client-v2): store chat threads per project in IndexedDB`

---

### Task 10: Threads follow the project switcher

**The last task that delivers user-visible value without the server working.**

The spec lists three gaps: (1) conversations are not tied to a project and do
not survive a reload, (2) code lives only in this browser, (3) there is no way
to move between threads. This task closes **1 and 3** entirely in the client —
chat persists to IndexedDB and follows the project switcher, with no network
call on the path.

Gap 2 is the cross-device half, and it is the only one that needs Postgres to
be reachable from the deployed functions. Tasks 11 onward are all gap 2.

*(This was originally written as a scope-cutting line — "ship this and drop the
auth work if stakeholders balk". That framing is now stale: auth, schema and
the API routes already exist, so there is nothing left to descope by stopping
here.)*

**What it still means, and why it matters right now:** Task 1 Step 13 — whether
a deployed Vercel function can reach the client's Postgres at all — **has not
been verified**. If it turns out it cannot, that is a networking/procurement
problem with lead time, not a code fix. Everything up to and including this task
still ships and still helps users; everything after it is blocked until that
question is answered. So this is the point at which the work stops depending on
an unverified external fact.

**Files:**
- Modify: `client-v2/src/views/sidebar/assistant/store.ts` (add `load`, `threadId`, persist on change)
- Modify: `client-v2/src/views/sidebar/assistant/model/openai.ts:52`, `:50` (accept a seed)
- Modify: `client-v2/src/views/sidebar/assistant/model/anthropic.ts:86` (accept a seed)
- Modify: `client-v2/src/views/sidebar/assistant/model/index.ts:24-50` (`createProvider` signature)
- Create: `client-v2/src/features/persistence/model/replay.ts`
- Create: `client-v2/src/features/persistence/model/replay.test.ts`
- Modify: `client-v2/src/views/sidebar/assistant/Component/Chat.tsx:55-58`, `:117-122`

**Interfaces:**
- Consumes: `PgChatStorage` (Task 9), `PgExplorer.currentWorkspaceId` (Task 7).
- Produces:
  - `toReplayMessages(items): {role: "user" | "assistant"; content: string}[]`
  - `PgAssistant.loadThread(threadId: string, force?: boolean): Promise<void>`
  - `PgAssistant.threadId: string | null`
  - `createProvider(connection, seed?: ReplayMessage[]): Provider`

- [ ] **Step 1: Write the failing test for the replay builder**

Create `client-v2/src/features/persistence/model/replay.test.ts`:

```ts
import { toReplayMessages } from "./replay";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

const base = { id: "a", createdAt: "2026-01-01T00:00:00.000Z" };

describe("toReplayMessages", () => {
  it("keeps user and assistant text in order", () => {
    const items: ChatItem[] = [
      { ...base, kind: "user", text: "hi" },
      { ...base, kind: "assistant", text: "hello" },
    ];

    expect(toReplayMessages(items)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("drops tool, approval, error and notice items", () => {
    const items: ChatItem[] = [
      { ...base, kind: "tool", label: "read src/lib.rs" },
      { ...base, kind: "approval", status: "allowed", request: { type: "command", name: "build", effect: "x" } },
      { ...base, kind: "error", text: "boom" },
      { ...base, kind: "notice", text: "stopped" },
    ];

    expect(toReplayMessages(items)).toEqual([]);
  });

  it("drops empty text, which a stopped turn leaves behind", () => {
    const items: ChatItem[] = [{ ...base, kind: "assistant", text: "  " }];
    expect(toReplayMessages(items)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern replay`
Expected: FAIL — cannot resolve `./replay`.

- [ ] **Step 3: Implement the replay builder**

Create `client-v2/src/features/persistence/model/replay.ts`:

```ts
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/** One turn of a rehydrated conversation, as every backend understands it */
export interface ReplayMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Rebuild enough history for the model to know what was said.
 *
 * Only what was said: tool calls and approvals are dropped, because their
 * provider-native records were never stored and a half-reconstructed tool
 * exchange is worse than none. What the model loses this way it gets back
 * from `describeProject`, which re-sends the live project on every turn — so
 * it remembers the conversation and sees the current files, rather than
 * remembering a file state that has since moved on.
 */
export const toReplayMessages = (
  items: readonly ChatItem[]
): ReplayMessage[] =>
  items.flatMap((item) =>
    (item.kind === "user" || item.kind === "assistant") && item.text.trim()
      ? [{ role: item.kind, content: item.text }]
      : []
  );
```

Export it from `client-v2/src/features/persistence/index.ts`:

```ts
export { PgChatStorage } from "./model/chat-storage";
export { toReplayMessages } from "./model/replay";
export type { ReplayMessage } from "./model/replay";
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `yarn test-unit --testPathPattern replay`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for thread loading**

Append to `client-v2/src/views/sidebar/assistant/store.test.ts`:

```ts
import { PgChatStorage } from "../../../features/persistence";

/** Storage writes are fired and forgotten, so let the microtask queue drain */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PgAssistant threads", () => {
  beforeEach(async () => {
    await PgChatStorage.clear();
    PgAssistant.clear();
  });

  it("writes the open thread through to storage on every change", async () => {
    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("hi");
    await settled();

    expect(await PgChatStorage.read("t1")).toHaveLength(1);
  });

  it("loads a stored thread when switching to it", async () => {
    await PgAssistant.loadThread("t1");
    PgAssistant.addUserMessage("in one");
    await settled();

    await PgAssistant.loadThread("t2");

    expect(PgAssistant.items).toHaveLength(0);

    await PgAssistant.loadThread("t1");

    expect(PgAssistant.items.map((i) => (i as { text: string }).text)).toEqual([
      "in one",
    ]);
  });

  it("does not persist anything before a thread is open", async () => {
    PgAssistant.addUserMessage("orphan");
    await settled();

    expect(await PgChatStorage.threadIds()).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern assistant/store`
Expected: FAIL — `loadThread` does not exist.

- [ ] **Step 7: Make the store thread-aware**

In `client-v2/src/views/sidebar/assistant/store.ts`, add the import and the thread state:

```ts
import { PgChatStorage, uuid } from "../../../features/persistence";
```

Add to `PgAssistant`:

```ts
  /** Which thread is open, or `null` before one has been chosen */
  static get threadId() {
    return PgAssistant._threadId;
  }

  /**
   * Open a thread, replacing whatever is rendered.
   *
   * Called when the workspace changes. Anything still awaiting approval
   * belongs to the thread being left, so it is denied rather than carried
   * across.
   *
   * Async because storage is IndexedDB. The thread id is claimed before the
   * read so a second switch that lands mid-read can be detected and its
   * result discarded — otherwise a slow read for project A would overwrite
   * the panel after the user has already moved to B.
   */
  static async loadThread(threadId: string, force = false) {
    if (!force && PgAssistant._threadId === threadId) return;
    PgAssistant.cancelPending();
    PgAssistant._threadId = threadId;
    PgAssistant._items = [];
    PgAssistant._status = "idle";
    PgAssistant._emitOnly();

    const items = await PgChatStorage.read(threadId);
    if (PgAssistant._threadId !== threadId) return;
    PgAssistant._items = items;
    PgAssistant._emitOnly();
  }

  private static _threadId: string | null = null;

  /**
   * Mirror the open thread to storage.
   *
   * Fired and not awaited: every mutator calls `_emit` synchronously and none
   * of them can usefully wait on a disk write. Failures are swallowed inside
   * `PgChatStorage`.
   */
  private static _persist() {
    if (PgAssistant._threadId) {
      void PgChatStorage.write(PgAssistant._threadId, PgAssistant._items);
    }
  }

  /** Notify without writing back — for changes that came *from* storage */
  private static _emitOnly() {
    for (const cb of PgAssistant._listeners) cb();
  }
```

and call `_persist()` from `_emit()`, so no mutator can forget it:

```ts
  private static _emit() {
    PgAssistant._persist();
    for (const cb of PgAssistant._listeners) cb();
  }
```

`clear()` must not wipe the stored thread when it is called on a backend switch. Change it to leave storage alone and only drop what is rendered:

```ts
  static clear() {
    PgAssistant.cancelPending();
    PgAssistant._items = [];
    PgAssistant._status = "idle";
    // Deliberately not `_emit`: this is a render reset (a backend switch), not
    // a conversation the user deleted, so it must not overwrite the thread.
    PgAssistant._emitOnly();
  }
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `yarn test-unit --testPathPattern assistant/store`
Expected: PASS.

- [ ] **Step 9: Let providers start from a seed**

In `client-v2/src/views/sidebar/assistant/model/openai.ts`, change the factory signature and the initial history:

```ts
export const createOpenAiProvider = (
  config: OpenAiConfig,
  seed: readonly ReplayMessage[] = []
): Provider => {
  const tools = createTools();
  const history: ChatMessage[] = seed.map((m) => ({
    role: m.role,
    content: m.content,
  }));
```

with `import type { ReplayMessage } from "../../../../features/persistence";` at the top.

In `client-v2/src/views/sidebar/assistant/model/anthropic.ts`, do the same at `:86`:

```ts
  let history: Anthropic.Beta.BetaMessageParam[] = seed.map((m) => ({
    role: m.role,
    content: m.content,
  }));
```

with the factory taking `seed: readonly ReplayMessage[] = []` as its third parameter.

In `client-v2/src/views/sidebar/assistant/model/index.ts`, thread the seed through:

```ts
export const createProvider = (
  { id, apiKey, endpoint, settings }: ProviderConnection,
  seed: readonly ReplayMessage[] = []
): Provider => {
  switch (id) {
    case "default":
      return createOpenAiProvider(
        {
          id,
          url: DEFAULT_BACKEND_URL,
          baseUrl: "",
          model: "",
          apiKey: "",
          label: "default backend",
        },
        seed
      );
    case "anthropic":
      return createAnthropicProvider(apiKey, settings, seed);
    case "openai":
    case "openrouter":
    case "gemini": {
      const defaults = PROVIDERS.find((p) => p.id === id)!.endpoint!;
      return createOpenAiProvider({ id, apiKey, ...(endpoint ?? defaults) }, seed);
    }
  }
};
```

- [ ] **Step 10: Wire the panel to the switcher**

In `client-v2/src/views/sidebar/assistant/Component/Chat.tsx`:

Open the thread for the current workspace on mount, and follow the switcher:

```tsx
  useEffect(() => {
    const open = () => {
      const id = PgExplorer.currentWorkspaceId;
      if (id) void PgAssistant.loadThread(id);
    };
    open();
    const sub = PgExplorer.onDidChangeWorkspace(open);
    return () => sub.dispose();
  }, []);
```

and seed the provider from what is rendered when it is built (`Chat.tsx:117-122`):

```tsx
    provider.current = {
      connection,
      instance: createProvider(connection, toReplayMessages(PgAssistant.items)),
    };
```

Import `PgExplorer` from `../../../../utils` and `toReplayMessages` from `../../../../features/persistence`.

- [ ] **Step 11: Verify by hand**

```sh
yarn dev
```

1. Send a message in project A. Reload. **The conversation is still there.**
2. Switch to project B with the header switcher. **The panel is empty.**
3. Switch back to A. **A's conversation returns.**
4. Ask a follow-up in A that depends on the earlier message ("what did I just ask you?"). **It answers from the replay.**
5. Rename A. **The conversation stays with it** (the id is stable).

- [ ] **Step 12: Full check and commit**

Run: `yarn test-types && yarn test-unit --watchAll=false && yarn build-fast`
Expected: all pass.

```sh
yarn format
git add client-v2/src
git commit
```

Message: `feat(client-v2): thread conversations by project and restore them on load`

---

### Task 11: `/api/conversations`

**Files:**
- Create: `client-v2/src/features/persistence/server/conversations.mjs`
- Create: `client-v2/src/features/persistence/server/conversations.test.mjs`
- Create: `client-v2/api/conversations.mjs`

**Interfaces:**
- Consumes: `query` (Task 1), `requireUser` (Task 3), the schema (Task 5).
- Produces:
  - `GET /api/conversations?projectId=<id>` → `{items: StoredItem[]}`
  - `POST /api/conversations` body `{projectId, items: StoredItem[]}` → `{written: number}`
  - `listMessages(userId, projectId)`, `appendMessages(userId, projectId, items)`

- [x] **Step 1: Write the failing integration test**

Create `client-v2/src/features/persistence/server/conversations.test.mjs`:

```js
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { query } from "./db.mjs";
import { appendMessages, listMessages } from "./conversations.mjs";

const DB = process.env.DATABASE_URL;

describe("conversations", { skip: !DB && "DATABASE_URL not set" }, () => {
  const userId = "test-user";

  before(async () => {
    await query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Test', 'test@example.com', false, now(), now())
       on conflict (id) do nothing`,
      [userId]
    );
  });

  beforeEach(async () => {
    await query("delete from projects where user_id = $1", [userId]);
  });

  const item = (n) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    kind: "user",
    createdAt: new Date(n * 1000).toISOString(),
    text: `m${n}`,
  });

  it("returns an empty thread for an unknown project", async () => {
    assert.deepEqual(await listMessages(userId, "nope"), []);
  });

  it("creates the project and conversation on first append", async () => {
    await appendMessages(userId, "p1", [item(1)]);
    const items = await listMessages(userId, "p1");
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "m1");
  });

  it("is idempotent, so a repeated dump changes nothing", async () => {
    await appendMessages(userId, "p1", [item(1), item(2)]);
    await appendMessages(userId, "p1", [item(1), item(2)]);
    assert.equal((await listMessages(userId, "p1")).length, 2);
  });

  it("orders by creation time, then id", async () => {
    await appendMessages(userId, "p1", [item(3), item(1), item(2)]);
    const items = await listMessages(userId, "p1");
    assert.deepEqual(
      items.map((i) => i.text),
      ["m1", "m2", "m3"]
    );
  });

  it("does not leak another user's thread", async () => {
    await appendMessages(userId, "p1", [item(1)]);
    assert.deepEqual(await listMessages("someone-else", "p1"), []);
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn test-api`
Expected: FAIL — `Cannot find module './conversations.mjs'`.

- [x] **Step 3: Implement the data layer**

Create `client-v2/src/features/persistence/server/conversations.mjs`:

```js
/**
 * Conversation reads and writes.
 *
 * Every statement is scoped by `user_id`, in the statement itself rather than
 * in a caller's check: a route that forgets the guard then returns nothing
 * instead of returning someone else's thread.
 */
import { getPool, query } from "./db.mjs";

/**
 * Ensure a project row and its conversation exist.
 *
 * @param {import("pg").PoolClient} client
 * @returns {Promise<string>} the conversation id
 */
const ensureConversation = async (client, userId, projectId) => {
  const kind = projectId.startsWith("tut:") ? "tutorial" : "project";

  // `(user_id, id)`, not `id`: a tutorial's id is derived, so every user who
  // starts the same one produces the same string
  await client.query(
    `insert into projects (id, user_id, name, kind)
     values ($1, $2, $1, $3)
     on conflict (user_id, id) do nothing`,
    [projectId, userId, kind]
  );

  // Newest live thread, because a project may hold several. No `on conflict`
  // to lean on -- that index is deliberately not unique any more.
  const existing = await client.query(
    `select id from conversations
      where user_id = $1 and project_id = $2 and deleted_at is null
      order by updated_at desc
      limit 1`,
    [userId, projectId]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const created = await client.query(
    `insert into conversations (id, user_id, project_id)
     values (gen_random_uuid(), $1, $2)
     returning id`,
    [userId, projectId]
  );
  return created.rows[0].id;
};

/**
 * Read one thread in order.
 *
 * @returns {Promise<object[]>} stored chat items, oldest first
 */
export const listMessages = async (userId, projectId) => {
  const { rows } = await query(
    `select m.payload
       from messages m
       join conversations c on c.id = m.conversation_id
      where c.user_id = $1 and c.project_id = $2 and c.deleted_at is null
      order by m.created_at, m.id`,
    [userId, projectId]
  );
  return rows.map((row) => row.payload);
};

/**
 * Append items to a thread.
 *
 * Ids are minted by the client, so this is safely repeatable: a second dump
 * of the same messages writes nothing. That is what lets sign-in sync run
 * unconditionally instead of exactly once.
 *
 * @returns {Promise<number>} how many rows were new
 */
export const appendMessages = async (userId, projectId, items) => {
  if (!items.length) return 0;

  const client = await getPool().connect();
  try {
    await client.query("begin");
    const conversationId = await ensureConversation(client, userId, projectId);

    const values = [];
    const params = [];
    items.forEach((item, i) => {
      const at = i * 4;
      values.push(`($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4})`);
      params.push(item.id, conversationId, item.kind, JSON.stringify(item));
    });

    const { rowCount } = await client.query(
      `insert into messages (id, conversation_id, kind, payload, created_at)
       select v.id::uuid, v.conversation_id::uuid, v.kind, v.payload::jsonb,
              (v.payload::jsonb ->> 'createdAt')::timestamptz
         from (values ${values.join(", ")})
              as v(id, conversation_id, kind, payload)
       on conflict (id) do nothing`,
      params
    );

    await client.query(
      "update conversations set updated_at = now() where id = $1",
      [conversationId]
    );
    await client.query("commit");
    return rowCount;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
};
```

- [x] **Step 4: Run the tests and confirm they pass**

Run: `DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn test-api`
Expected: PASS, 5 conversation tests.

- [x] **Step 5: Implement the route**

Create `client-v2/api/conversations.mjs`:

```js
/**
 * Conversation sync.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
import { requireUser } from "../src/features/persistence/server/auth.mjs";
import {
  appendMessages,
  listMessages,
} from "../src/features/persistence/server/conversations.mjs";
import { isEnabled } from "../src/features/persistence/server/db.mjs";

/** Anything larger is not a conversation batch, it is an attack or a bug */
const MAX_BODY_BYTES = 2_000_000;
const MAX_ITEMS = 500;

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

export default async function handler(req, res) {
  if (!isEnabled()) return sendJson(res, 503, { error: "Sync is disabled" });

  const user = await requireUser(req);
  if (!user) return sendJson(res, 401, { error: "Not signed in" });

  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return sendJson(res, 400, { error: "projectId required" });
    return sendJson(res, 200, {
      items: await listMessages(user.id, projectId),
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 413, { error: e.message });
    }

    const { projectId, items } = body;
    if (typeof projectId !== "string" || !Array.isArray(items)) {
      return sendJson(res, 400, { error: "projectId and items required" });
    }
    if (items.length > MAX_ITEMS) {
      return sendJson(res, 413, { error: `At most ${MAX_ITEMS} items` });
    }
    if (!items.every((i) => i && typeof i.id === "string" && typeof i.kind === "string")) {
      return sendJson(res, 400, { error: "Malformed items" });
    }

    return sendJson(res, 200, {
      written: await appendMessages(user.id, projectId, items),
    });
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}
```

- [x] **Step 6: Verify against the running dev server**

```sh
curl -s "localhost:3000/api/conversations?projectId=p1"
```

Expected: `401` signed out, `503` with `SYNC_ENABLED` unset.

- [x] **Step 7: Format**

```sh
yarn format
```

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/api/conversations.mjs client-v2/src/features/persistence/server/conversations.mjs client-v2/src/features/persistence/server/conversations.test.mjs
git commit
```

Message: `feat(client-v2): add conversation sync endpoints`

---

### Task 12: `/api/projects`

**Files:**
- Create: `client-v2/src/features/persistence/server/projects.mjs`
- Create: `client-v2/src/features/persistence/server/projects.test.mjs`
- Create: `client-v2/api/projects.mjs`

**Interfaces:**
- Consumes: `query`, `getPool` (Task 1), `requireUser` (Task 3), schema (Task 5).
- Produces:
  - `GET /api/projects` → `{projects: {id, name, kind, updatedAt}[]}`
  - `GET /api/projects?id=<id>` → `{project: {id, name, kind, snapshot, updatedAt}}`
  - `PUT /api/projects` body `{id, name, kind, snapshot, baseUpdatedAt}` → `200 {updatedAt}` or `409 {conflict: true, updatedAt}`
  - `DELETE /api/projects?id=<id>` → `{deleted: true}` (tombstone)

- [x] **Step 1: Write the failing integration test**

Create `client-v2/src/features/persistence/server/projects.test.mjs`:

```js
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { query } from "./db.mjs";
import { deleteProject, getProject, listProjects, saveProject } from "./projects.mjs";

const DB = process.env.DATABASE_URL;

describe("projects", { skip: !DB && "DATABASE_URL not set" }, () => {
  const userId = "test-user-projects";

  before(async () => {
    await query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Test', 'projects@example.com', false, now(), now())
       on conflict (id) do nothing`,
      [userId]
    );
  });

  beforeEach(async () => {
    await query("delete from projects where user_id = $1", [userId]);
  });

  const snapshot = { files: { "src/lib.rs": "fn main() {}" } };

  it("saves and reads a snapshot back", async () => {
    await saveProject(userId, { id: "p1", name: "one", kind: "project", snapshot });
    const project = await getProject(userId, "p1");
    assert.deepEqual(project.snapshot, snapshot);
  });

  it("accepts a write that carries the current updatedAt", async () => {
    const first = await saveProject(userId, { id: "p1", name: "one", kind: "project", snapshot });
    const second = await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
      baseUpdatedAt: first.updatedAt,
    });
    assert.ok(second.updatedAt);
  });

  it("refuses a write built on a stale read", async () => {
    await saveProject(userId, { id: "p1", name: "one", kind: "project", snapshot });
    const result = await saveProject(userId, {
      id: "p1",
      name: "one",
      kind: "project",
      snapshot,
      baseUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    assert.equal(result.conflict, true);
  });

  it("tombstones rather than deleting, so another device does not resurrect it", async () => {
    await saveProject(userId, { id: "p1", name: "one", kind: "project", snapshot });
    await deleteProject(userId, "p1");

    assert.equal(await getProject(userId, "p1"), null);
    const { rows } = await query(
      "select deleted_at from projects where id = $1 and user_id = $2",
      ["p1", userId]
    );
    assert.ok(rows[0].deleted_at);
  });

  it("omits tombstoned projects from the list", async () => {
    await saveProject(userId, { id: "p1", name: "one", kind: "project", snapshot });
    await saveProject(userId, { id: "p2", name: "two", kind: "project", snapshot });
    await deleteProject(userId, "p1");

    const list = await listProjects(userId);
    assert.deepEqual(list.map((p) => p.id), ["p2"]);
  });

  it("frees the name for reuse once tombstoned", async () => {
    await saveProject(userId, { id: "p1", name: "one", kind: "project", snapshot });
    await deleteProject(userId, "p1");
    const again = await saveProject(userId, { id: "p2", name: "one", kind: "project", snapshot });
    assert.ok(again.updatedAt);
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn test-api`
Expected: FAIL — `Cannot find module './projects.mjs'`.

- [x] **Step 3: Implement the data layer**

Create `client-v2/src/features/persistence/server/projects.mjs`:

```js
/**
 * Project snapshot reads and writes.
 *
 * Last write wins, but only among writers that had seen the current state:
 * a client whose `baseUpdatedAt` is behind is told so instead of overwriting.
 * That is the difference between "your other device won" and "your other
 * device's work is gone".
 */
import { query } from "./db.mjs";

export const listProjects = async (userId) => {
  const { rows } = await query(
    `select id, name, kind, updated_at
       from projects
      where user_id = $1 and deleted_at is null
      order by updated_at desc`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    updatedAt: r.updated_at.toISOString(),
  }));
};

export const getProject = async (userId, id) => {
  const { rows } = await query(
    `select id, name, kind, snapshot, updated_at
       from projects
      where user_id = $1 and id = $2 and deleted_at is null`,
    [userId, id]
  );
  if (!rows.length) return null;
  const [r] = rows;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    snapshot: r.snapshot,
    updatedAt: r.updated_at.toISOString(),
  };
};

/**
 * Write a snapshot.
 *
 * @param {{id: string, name: string, kind: string, snapshot: object,
 *          baseUpdatedAt?: string}} input
 * @returns {Promise<{updatedAt: string} | {conflict: true, updatedAt: string}>}
 */
export const saveProject = async (userId, input) => {
  const { id, name, kind, snapshot, baseUpdatedAt } = input;

  if (baseUpdatedAt) {
    const { rows } = await query(
      `update projects
          set name = $3, kind = $4, snapshot = $5, updated_at = now()
        where user_id = $1 and id = $2 and deleted_at is null
          and updated_at = $6
        returning updated_at`,
      [userId, id, name, kind, snapshot, baseUpdatedAt]
    );
    if (rows.length) return { updatedAt: rows[0].updated_at.toISOString() };

    const current = await getProject(userId, id);
    return { conflict: true, updatedAt: current?.updatedAt ?? null };
  }

  const { rows } = await query(
    `insert into projects (id, user_id, name, kind, snapshot, updated_at)
     values ($2, $1, $3, $4, $5, now())
     on conflict (user_id, id) do update
       set name = excluded.name,
           kind = excluded.kind,
           snapshot = excluded.snapshot,
           updated_at = now(),
           deleted_at = null
     returning updated_at`,
    [userId, id, name, kind, snapshot]
  );
  return { updatedAt: rows[0].updated_at.toISOString() };
};

/**
 * Tombstone a project.
 *
 * The row stays so another device's next sync sees "deleted" rather than
 * "missing" and does not push its local copy back up. The name is cleared of
 * the live-rows unique index by the same stroke, so it can be reused.
 */
export const deleteProject = async (userId, id) => {
  await query(
    `update projects set deleted_at = now(), snapshot = null
      where user_id = $1 and id = $2 and deleted_at is null`,
    [userId, id]
  );
};
```

- [x] **Step 4: Run the tests and confirm they pass**

Run: `DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn test-api`
Expected: PASS, 6 project tests.

- [x] **Step 5: Implement the route**

Create `client-v2/api/projects.mjs`, following `api/conversations.mjs` exactly for the `isEnabled` / `requireUser` / `sendJson` / `readBody` preamble (copy those four helpers — `api/` has no shared module for them yet and duplicating four small functions is cheaper than inventing one):

```js
/**
 * Project snapshot sync.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
import { requireUser } from "../src/features/persistence/server/auth.mjs";
import { isEnabled } from "../src/features/persistence/server/db.mjs";
import {
  deleteProject,
  getProject,
  listProjects,
  saveProject,
} from "../src/features/persistence/server/projects.mjs";

/** A workspace larger than this is not something we sync silently */
const MAX_BODY_BYTES = 8_000_000;

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

export default async function handler(req, res) {
  if (!isEnabled()) return sendJson(res, 503, { error: "Sync is disabled" });

  const user = await requireUser(req);
  if (!user) return sendJson(res, 401, { error: "Not signed in" });

  const url = new URL(req.url, "http://localhost");
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    if (!id) return sendJson(res, 200, { projects: await listProjects(user.id) });
    const project = await getProject(user.id, id);
    return project
      ? sendJson(res, 200, { project })
      : sendJson(res, 404, { error: "Not found" });
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 413, { error: e.message });
    }

    if (
      typeof body.id !== "string" ||
      typeof body.name !== "string" ||
      !["project", "tutorial"].includes(body.kind)
    ) {
      return sendJson(res, 400, { error: "id, name and kind required" });
    }

    const result = await saveProject(user.id, body);
    return result.conflict
      ? sendJson(res, 409, result)
      : sendJson(res, 200, result);
  }

  if (req.method === "DELETE") {
    if (!id) return sendJson(res, 400, { error: "id required" });
    await deleteProject(user.id, id);
    return sendJson(res, 200, { deleted: true });
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}
```

- [x] **Step 6: Format**

```sh
yarn format
```

**For the owner to run when ready** (not a task step — commits are yours):

```sh
git add client-v2/api/projects.mjs client-v2/src/features/persistence/server/projects.mjs client-v2/src/features/persistence/server/projects.test.mjs
git commit
```

Message: `feat(client-v2): add project snapshot sync endpoints`

---

### Task 13: Client chat sync

**Files:**
- Create: `client-v2/src/features/persistence/model/sync-client.ts`
- Create: `client-v2/src/features/persistence/model/chat-sync.ts`
- Create: `client-v2/src/features/persistence/model/chat-sync.test.ts`
- Modify: `client-v2/src/views/sidebar/assistant/Component/Chat.tsx` (end-of-turn hook)

**Interfaces:**
- Consumes: `PgChatStorage` (Task 9), `PgSession` (Task 4), `/api/sync`, `/api/conversations` (Task 11).
- Produces:
  - `PgSyncClient.available(): Promise<boolean>` — memoised `/api/sync` probe
  - `PgChatSync.pull(threadId): Promise<ChatItem[] | null>`
  - `PgChatSync.push(threadId): Promise<void>`
  - `PgChatSync.pushAll(): Promise<boolean>` — the sign-in dump; `false` if anything failed

- [x] **Step 1: Write the failing test**

Create `client-v2/src/features/persistence/model/chat-sync.test.ts`:

```ts
import { PgChatStorage } from "./chat-storage";
import { PgChatSync } from "./chat-sync";
import { PgSession } from "./session";
import { PgSyncClient } from "./sync-client";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

const item = (n: number): ChatItem => ({
  kind: "user",
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  createdAt: new Date(n * 1000).toISOString(),
  text: `m${n}`,
});

describe("PgChatSync", () => {
  beforeEach(async () => {
    await PgChatStorage.clear();
    PgSession.reset();
    PgSyncClient.reset();
  });

  it("does nothing when signed out", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    await PgChatStorage.write("t1", [item(1)]);

    await PgChatSync.push("t1");

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts the local thread when signed in", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url === "/api/sync") {
        return Promise.resolve({ ok: true, json: async () => ({ enabled: true, db: "ok" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ written: 1 }) });
    }) as unknown as typeof fetch;
    await PgSession.refreshWith({ id: "u1", name: null });
    await PgChatStorage.write("t1", [item(1)]);

    await PgChatSync.push("t1");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/conversations",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("keeps the local thread when the push fails, so nothing is lost", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve({ ok: true, json: async () => ({ enabled: true, db: "ok" }) })
        : Promise.reject(new Error("offline"))
    ) as unknown as typeof fetch;
    await PgSession.refreshWith({ id: "u1", name: null });
    await PgChatStorage.write("t1", [item(1)]);

    const ok = await PgChatSync.pushAll();

    expect(ok).toBe(false);
    expect(await PgChatStorage.read("t1")).toHaveLength(1);
  });

  it("merges the server thread with local items on pull, without duplicates", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve({ ok: true, json: async () => ({ enabled: true, db: "ok" }) })
        : Promise.resolve({ ok: true, json: async () => ({ items: [item(1), item(2)] }) })
    ) as unknown as typeof fetch;
    await PgSession.refreshWith({ id: "u1", name: null });
    await PgChatStorage.write("t1", [item(2), item(3)]);

    const merged = await PgChatSync.pull("t1");

    expect(merged!.map((i) => (i as { text: string }).text)).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });
});
```

Add the test seam to `PgSession` (`session.ts`), next to `reset`:

```ts
  /** Test seam: set the user without a network round trip */
  static async refreshWith(user: SessionUser | null) {
    PgSession._set(user);
  }
```

- [x] **Step 2: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern chat-sync`
Expected: FAIL — cannot resolve `./chat-sync`.

- [x] **Step 3: Implement the probe client**

Create `client-v2/src/features/persistence/model/sync-client.ts`:

```ts
/**
 * Whether the backend will accept sync at all.
 *
 * Asked once and remembered, the same way the assistant panel probes
 * `/api/agent` before offering the default backend. A deployment with no
 * database answers "no" and every caller quietly stays local.
 */
export class PgSyncClient {
  static async available(): Promise<boolean> {
    if (PgSyncClient._available === null) {
      PgSyncClient._available = PgSyncClient._probe();
    }
    return PgSyncClient._available;
  }

  /** Test seam: forget the memoised probe */
  static reset() {
    PgSyncClient._available = null;
  }

  private static _available: Promise<boolean> | null = null;

  private static async _probe(): Promise<boolean> {
    try {
      const response = await fetch("/api/sync", { cache: "no-store" });
      if (!response.ok) return false;
      const body = await response.json();
      return body?.enabled === true;
    } catch {
      return false;
    }
  }
}
```

- [x] **Step 4: Implement chat sync**

Create `client-v2/src/features/persistence/model/chat-sync.ts`:

```ts
import { PgChatStorage } from "./chat-storage";
import { PgSession } from "./session";
import { PgSyncClient } from "./sync-client";
import { decodeThread, encodeThread } from "./chat-codec";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/** Oldest first, ties broken by id so two devices agree on the order */
const byTime = (a: ChatItem, b: ChatItem) =>
  a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);

const merge = (server: ChatItem[], local: ChatItem[]) => {
  const byId = new Map<string, ChatItem>();
  for (const item of [...server, ...local]) byId.set(item.id, item);
  return [...byId.values()].sort(byTime);
};

/**
 * Mirror local threads to Postgres.
 *
 * Push is append-only and every id is minted on the client, so it is safe to
 * repeat: signing in on a third device, or retrying after a failure, writes
 * only what is genuinely new.
 */
export class PgChatSync {
  /** @returns the merged thread, or `null` when sync is unavailable */
  static async pull(threadId: string): Promise<ChatItem[] | null> {
    if (!(await PgChatSync._ready())) return null;

    try {
      const response = await fetch(
        `/api/conversations?projectId=${encodeURIComponent(threadId)}`,
        { credentials: "include", cache: "no-store" }
      );
      if (!response.ok) return null;

      const body = await response.json();
      const merged = merge(
        decodeThread(body?.items),
        await PgChatStorage.read(threadId)
      );
      await PgChatStorage.write(threadId, merged);
      return merged;
    } catch {
      return null;
    }
  }

  static async push(threadId: string): Promise<boolean> {
    if (!(await PgChatSync._ready())) return false;

    const items = await PgChatStorage.read(threadId);
    if (!items.length) return true;

    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: threadId,
          items: encodeThread(items),
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Push every local thread — the sign-in dump, and the last thing that runs
   * before sign-out clears local storage.
   *
   * @returns whether everything made it. `false` means keep the local copy.
   */
  static async pushAll(): Promise<boolean> {
    if (!(await PgChatSync._ready())) return false;

    const threadIds = await PgChatStorage.threadIds();
    const results = await Promise.all(
      threadIds.map((id) => PgChatSync.push(id))
    );
    return results.every(Boolean);
  }

  private static async _ready() {
    return !!PgSession.get() && (await PgSyncClient.available());
  }
}
```

- [x] **Step 5: Run the tests and confirm they pass**

Run: `yarn test-unit --testPathPattern chat-sync`
Expected: PASS, 5 tests.

- [x] **Step 6: Trigger sync from the panel**

In `client-v2/src/views/sidebar/assistant/Component/Chat.tsx`, push at end of turn — the existing transition back to `"idle"` in the `send` handler's `finally` (`Chat.tsx:124-146`):

```tsx
    } finally {
      PgAssistant.setStatus("idle");
      const threadId = PgAssistant.threadId;
      if (threadId) void PgChatSync.push(threadId);
    }
```

and pull once when a thread opens, in the effect added in Task 10:

```tsx
    const open = async () => {
      const id = PgExplorer.currentWorkspaceId;
      if (!id) return;
      await PgAssistant.loadThread(id);
      const merged = await PgChatSync.pull(id);
      // `pull` rewrote storage, so reopen past `loadThread`'s unchanged-id
      // guard -- but only if the user has not switched away in the meantime
      if (merged && PgAssistant.threadId === id) {
        await PgAssistant.loadThread(id, true);
      }
    };
```

`loadThread` already takes the `force` flag and already guards against a switch landing mid-read (Task 10, Step 7).

- [x] **Step 7: Sync on sign-in and sign-out**

In `client-v2/src/features/persistence/model/session.ts`, dump on sign-in and clear on a successful final sync:

```ts
  static async signOut() {
    // Last chance to get local threads to the server. If it fails, the local
    // copy stays and the next sign-in tries again — losing messages to a flaky
    // network would be the worse failure.
    const synced = await PgChatSync.pushAll();
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    PgSession._set(null);
    if (synced) await PgChatStorage.clear();
  }
```

and after a `refresh()` that produces a user where there was none, call `void PgChatSync.pushAll()`.

- [ ] **Step 8: Verify by hand across two browsers**

1. Signed out in browser A, chat in project "demo". Sign in. Reload.
2. Sign in as the same user in browser B (a different profile), open project "demo".
3. **B shows A's conversation.**
4. Add a message in B, then reload A and reopen "demo". **A shows B's message.**

- [ ] **Step 9: Full check and commit**

Run: `yarn test-types && yarn test-unit --watchAll=false`

```sh
yarn format
git add client-v2/src
git commit
```

Message: `feat(client-v2): sync conversation threads to Postgres`

---

### Task 14: Client code snapshot sync

**Files:**
- Create: `client-v2/src/features/persistence/model/snapshot.ts`
- Create: `client-v2/src/features/persistence/model/snapshot.test.ts`
- Create: `client-v2/src/features/persistence/model/project-sync.ts`
- Create: `client-v2/src/features/persistence/model/project-sync.test.ts`
- Create: `client-v2/src/features/persistence/Component/SyncBanner.tsx`
- Modify: `client-v2/src/views/flow/header/ProjectSwitcher.tsx` (render the banner)

**Interfaces:**
- Consumes: `PgExplorer.getAllFiles()`, `PgExplorer.currentWorkspaceId` (Task 7), `PgSyncClient`, `PgSession`, `/api/projects` (Task 12).
- Produces:
  - `buildSnapshot(): Promise<{files: Record<string, string>}>`
  - `applySnapshot(snapshot): Promise<void>`
  - `PgProjectSync.push(): Promise<"ok" | "conflict" | "skipped">`
  - `PgProjectSync.pull(id): Promise<void>`
  - `PgProjectSync.importLocal(): Promise<{imported: string[]}>`
  - `PgProjectSync.onDidConflict(cb): Disposable`

- [x] **Step 1: Write the failing test for snapshot building**

Create `client-v2/src/features/persistence/model/snapshot.test.ts`:

```ts
import { filterSnapshotPaths, SYNCED_WORKSPACE_FILES } from "./snapshot";

describe("filterSnapshotPaths", () => {
  it("keeps user source files", () => {
    expect(filterSnapshotPaths(["src/lib.rs", "client/client.ts"])).toEqual([
      "src/lib.rs",
      "client/client.ts",
    ]);
  });

  it("keeps the workspace files the spec names, program keypair included", () => {
    expect(filterSnapshotPaths(SYNCED_WORKSPACE_FILES)).toEqual(
      SYNCED_WORKSPACE_FILES
    );
  });

  it("drops anything else under .workspace", () => {
    expect(filterSnapshotPaths([".workspace/scratch.json"])).toEqual([]);
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern snapshot`
Expected: FAIL — cannot resolve `./snapshot`.

- [x] **Step 3: Implement snapshot building**

Create `client-v2/src/features/persistence/model/snapshot.ts`:

```ts
import { PgExplorer } from "../../../utils";

/**
 * Workspace files that travel with the code.
 *
 * `program-info.json` carries the program keypair. Syncing it is a deliberate
 * decision recorded in the spec: without it the same project deploys to a
 * different address on every device, which is the thing users notice. This is
 * a playground, the keys are playground keys, and the UI says so.
 */
export const SYNCED_WORKSPACE_FILES = [
  ".workspace/metadata.json",
  ".workspace/program-info.json",
  ".workspace/tutorial-storage.json",
  ".tutorial.json",
];

/** Keep user files and the named workspace files; drop everything else */
export const filterSnapshotPaths = (paths: readonly string[]) =>
  paths.filter(
    (path) =>
      SYNCED_WORKSPACE_FILES.includes(path) || !path.startsWith(".workspace/")
  );

/** One project, as it is stored */
export interface Snapshot {
  files: Record<string, string>;
}

/** Serialize the current workspace */
export const buildSnapshot = async (): Promise<Snapshot> => {
  const tuples = await PgExplorer.getAllFiles();
  const prefix = `/${PgExplorer.currentWorkspaceName}/`;
  const files: Record<string, string> = {};

  for (const [fullPath, content] of tuples) {
    const path = fullPath.startsWith(prefix)
      ? fullPath.slice(prefix.length)
      : fullPath.replace(/^\//, "");
    files[path] = content;
  }

  const kept = filterSnapshotPaths(Object.keys(files));
  return {
    files: Object.fromEntries(kept.map((path) => [path, files[path]])),
  };
};

/** Cheap change detection, so an unchanged workspace is not re-uploaded */
export const hashSnapshot = (snapshot: Snapshot) => {
  const text = JSON.stringify(snapshot);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return `${text.length}:${hash}`;
};

/** Write a snapshot into the current workspace, overwriting what is there */
export const applySnapshot = async (snapshot: Snapshot) => {
  for (const [path, content] of Object.entries(snapshot.files)) {
    await PgExplorer.createItem(
      PgExplorer.getCanonicalPath(path),
      content,
      { override: true }
    );
  }
};
```

Verify `PgExplorer.getCanonicalPath` exists with that name before relying on it (`utils/explorer/explorer.ts`); if the project-relative-to-absolute helper is named differently, use the actual one and keep the comment accurate.

- [x] **Step 4: Run the tests and confirm they pass**

Run: `yarn test-unit --testPathPattern snapshot`
Expected: PASS, 3 tests.

- [x] **Step 5: Write the failing test for push semantics**

Create `client-v2/src/features/persistence/model/project-sync.test.ts`:

```ts
import { PgProjectSync } from "./project-sync";
import { PgSession } from "./session";
import { PgSyncClient } from "./sync-client";

const okProbe = { ok: true, json: async () => ({ enabled: true, db: "ok" }) };

describe("PgProjectSync", () => {
  beforeEach(() => {
    PgSession.reset();
    PgSyncClient.reset();
    PgProjectSync.reset();
  });

  it("skips entirely when signed out", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(await PgProjectSync.push("p1", { files: {} })).toBe("skipped");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips an unchanged snapshot rather than re-uploading it", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({ ok: true, json: async () => ({ updatedAt: "t1" }) })
    ) as unknown as typeof fetch;
    await PgSession.refreshWith({ id: "u1", name: null });

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe("ok");
    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe("skipped");
  });

  it("reports a conflict instead of overwriting a newer server copy", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url === "/api/sync"
        ? Promise.resolve(okProbe)
        : Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({ conflict: true, updatedAt: "t9" }),
          })
    ) as unknown as typeof fetch;
    await PgSession.refreshWith({ id: "u1", name: null });
    const seen: string[] = [];
    PgProjectSync.onDidConflict((id) => seen.push(id));

    expect(await PgProjectSync.push("p1", { files: { a: "1" } })).toBe("conflict");
    expect(seen).toEqual(["p1"]);
  });
});
```

- [x] **Step 6: Run it and confirm it fails**

Run: `yarn test-unit --testPathPattern project-sync`
Expected: FAIL — cannot resolve `./project-sync`.

- [x] **Step 7: Implement project sync**

Create `client-v2/src/features/persistence/model/project-sync.ts`:

```ts
import { hashSnapshot } from "./snapshot";
import { PgSession } from "./session";
import { PgSyncClient } from "./sync-client";
import type { Snapshot } from "./snapshot";
import type { Disposable } from "../../../utils";

type PushResult = "ok" | "conflict" | "skipped";

/**
 * Mirror project snapshots to Postgres.
 *
 * Last write wins, but a client whose `baseUpdatedAt` is stale is refused and
 * raises a conflict instead. Nothing is ever merged: two divergent copies of a
 * program are not something an automatic merge can reconcile, and a bad merge
 * is worse than a prompt.
 */
export class PgProjectSync {
  static async push(projectId: string, snapshot: Snapshot): Promise<PushResult> {
    if (!(await PgProjectSync._ready())) return "skipped";

    const hash = hashSnapshot(snapshot);
    if (PgProjectSync._hashes.get(projectId) === hash) return "skipped";

    try {
      const response = await fetch("/api/projects", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: projectId,
          name: PgProjectSync._names.get(projectId) ?? projectId,
          kind: projectId.startsWith("tut:") ? "tutorial" : "project",
          snapshot,
          baseUpdatedAt: PgProjectSync._base.get(projectId),
        }),
      });

      if (response.status === 409) {
        for (const cb of PgProjectSync._conflictListeners) cb(projectId);
        return "conflict";
      }
      if (!response.ok) return "skipped";

      const body = await response.json();
      PgProjectSync._base.set(projectId, body.updatedAt);
      PgProjectSync._hashes.set(projectId, hash);
      return "ok";
    } catch {
      return "skipped";
    }
  }

  /** Record the server's state for a project we just read */
  static seen(projectId: string, name: string, updatedAt: string) {
    PgProjectSync._names.set(projectId, name);
    PgProjectSync._base.set(projectId, updatedAt);
  }

  static onDidConflict(cb: (projectId: string) => void): Disposable {
    PgProjectSync._conflictListeners.add(cb);
    return { dispose: () => PgProjectSync._conflictListeners.delete(cb) };
  }

  /** Test seam */
  static reset() {
    PgProjectSync._base.clear();
    PgProjectSync._hashes.clear();
    PgProjectSync._names.clear();
    PgProjectSync._conflictListeners.clear();
  }

  private static readonly _base = new Map<string, string>();
  private static readonly _hashes = new Map<string, string>();
  private static readonly _names = new Map<string, string>();
  private static readonly _conflictListeners = new Set<
    (projectId: string) => void
  >();

  private static async _ready() {
    return !!PgSession.get() && (await PgSyncClient.available());
  }
}
```

- [x] **Step 8: Run the tests and confirm they pass**

Run: `yarn test-unit --testPathPattern project-sync`
Expected: PASS, 3 tests.

- [x] **Step 9: Add the conflict banner**

Create `client-v2/src/features/persistence/Component/SyncBanner.tsx`:

```tsx
import { useEffect, useState } from "react";
import styled from "styled-components";

import { PgProjectSync } from "../model/project-sync";

/**
 * Tells the user their other device has newer work, and stops autosaving.
 *
 * Deliberately a prompt rather than a merge or a silent overwrite: the
 * failure this prevents is "I opened the project on my phone and lost an
 * afternoon on my laptop".
 */
export const SyncBanner = () => {
  const [conflicted, setConflicted] = useState<string | null>(null);

  useEffect(() => {
    const sub = PgProjectSync.onDidConflict(setConflicted);
    return () => sub.dispose();
  }, []);

  if (!conflicted) return null;

  return (
    <Wrapper>
      This project changed on another device. Reload to take that version, or
      keep editing here and save over it.
      <Action onClick={() => window.location.reload()}>Reload</Action>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  ${({ theme }) => `
    padding: 0.5rem 0.75rem;
    background: ${theme.colors.state.warning.bg};
    color: ${theme.colors.default.textPrimary};
    font-size: ${theme.font.code.size.small};
    display: flex;
    align-items: center;
    gap: 0.75rem;
  `}
`;

const Action = styled.button`
  text-decoration: underline;
  cursor: pointer;
`;
```

Check the theme token names against an existing styled component in `views/flow/` before committing — use whatever that file uses rather than inventing tokens.

Render it in `client-v2/src/views/flow/header/ProjectSwitcher.tsx`, above the switcher.

- [ ] **Step 10: Wire the debounced push and the import prompt**

Subscribe to the explorer's change events where the panel already listens, pushing on a 3-second trailing debounce:

```ts
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const id = PgExplorer.currentWorkspaceId;
        if (id) await PgProjectSync.push(id, await buildSnapshot());
      }, 3000);
    };
    const sub = PgExplorer.onDidChangeItem(schedule);
    window.addEventListener("beforeunload", schedule);
    return () => {
      clearTimeout(timer);
      sub.dispose();
      window.removeEventListener("beforeunload", schedule);
    };
  }, []);
```

For the first sign-in import, add a modal that lists local workspace names and asks before uploading, suffixing any name that already exists on the server with ` (imported)`. Follow the existing modal pattern in `views/sidebar/explorer/Component/Modals/`.

- [ ] **Step 11: Verify by hand**

1. Sign in on browser A, edit `src/lib.rs`, wait 3 seconds.
2. Sign in on browser B, open the same project. **B has A's code.**
3. Edit in both without reloading, save in B, then edit in A. **A shows the conflict banner and stops autosaving.**
4. Confirm `program-info.json` round-trips: deploy in A, open in B, and check the program id matches.

- [ ] **Step 12: Full check and commit**

Run: `yarn test-types && yarn test-unit --watchAll=false && yarn build-fast`

```sh
yarn format
git add client-v2/src
git commit
```

Message: `feat(client-v2): sync project snapshots to Postgres`

---

### Task 15: CI, documentation, and the assistant's own context

**Files:**
- Modify: `.github/workflows/client-v2.yml`
- Modify: `docs/assistant-context.md`
- Modify: `client-v2/docs/deploy-client-vercel.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: green CI with a real Postgres, and documentation that matches the code.

- [x] **Step 1: Add Postgres and API tests to CI**

In `.github/workflows/client-v2.yml`, add to the job that runs the checks:

```yaml
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: solpg
          POSTGRES_PASSWORD: solpg
          POSTGRES_DB: solpg
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
```

and, after `yarn install`, before the existing checks:

```yaml
      - name: Install dbmate
        run: |
          curl -fsSL -o /usr/local/bin/dbmate \
            https://github.com/amacneil/dbmate/releases/latest/download/dbmate-linux-amd64
          chmod +x /usr/local/bin/dbmate

      - name: Apply migrations
        working-directory: client-v2
        env:
          DATABASE_URL: postgres://solpg:solpg@localhost:5432/solpg?sslmode=disable
        run: yarn db-migrate

      - name: API tests
        working-directory: client-v2
        env:
          DATABASE_URL: postgres://solpg:solpg@localhost:5432/solpg?sslmode=disable
        run: yarn test-api
```

- [ ] **Step 2: Push and confirm CI is green**

Push the branch and check the `client-v2` workflow. Expected: all steps pass, including the API tests against real Postgres.

- [x] **Step 3: Correct `docs/assistant-context.md`**

This file is loaded into the assistant's own system prompt (`model/prompt.ts:60`), so a stale claim here is something the model will tell users. Three edits:

1. In the principles list (`:64-74`), the line "**No backend changes.** The build server, crate list, deploy mechanics and sharing infrastructure are out of scope." — append: "Conversation and project sync is the exception, and it is additive: new `api/*` routes and a Postgres of our own. The build server and its database are still untouched."
2. In the persistence section (`:157-158`), add: "Conversations and project code are persisted. Threads are keyed by project or tutorial, kept in IndexedDB on the device, and synced to Postgres when signed in. A restored thread is history the model can read back, not a resumed session: the provider is re-seeded from the text of the conversation, and the tool calls behind it are not replayed."
3. In "Real vs mocked" (`:170-215`), move key handling out of "prototype-grade" only if it changed — it did not, so leave it, and add a line: "**Real:** conversation and project sync, behind a capability probe. **Still prototype-grade:** the default backend has no cost gate."

Then run `yarn sync-assistant-context` so the copy under `src/views/sidebar/assistant/content/` matches.

- [x] **Step 4: Document deployment**

In `client-v2/docs/deploy-client-vercel.md`, add a section listing the new environment variables (`DATABASE_URL`, `SYNC_ENABLED`, `AUTH_SECRET`, `AUTH_BASE_URL`, and the existing `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`), the requirement that `DATABASE_URL` be a **pooled** connection string, and that **migrations are applied manually** with `yarn db-migrate` before enabling `SYNC_ENABLED` on an environment.

State the known gaps explicitly: signed-in E2E sync tests are not covered, and `/api/agent` is still ungated.

- [x] **Step 5: Update `CLAUDE.md`**

Add to the Gotchas section:

```markdown
- **There are now two databases.** `server/` (upstream's Rust build server)
  uses MongoDB and is untouched. Conversation and project sync uses a separate
  Postgres reached only from `client-v2/api/*.mjs`. Migrations live in
  `client-v2/db/migrations`, are applied with `yarn db-migrate`, and are never
  run from a serverless function.
- **`api/*.mjs` is not covered by `yarn test-unit`.** CRA's Jest is rooted at
  `src` and the server modules need real Node. Run `yarn test-api`
  (`node --test`); the database-backed cases skip without `DATABASE_URL`.
- **Chat threads share the code's IndexedDB volume**, as files under
  `/.config/chats/<threadId>.json` via `PgFs` — not `localStorage`, which is
  already near its origin budget with `settings`, `wallet`, `theme` and
  `flow.deploys`. `threadId` is the stable workspace id, so a rename keeps the
  conversation.
```

- [x] **Step 6: Final verification**

Run, from `client-v2/`:

```sh
yarn check-format
yarn test-types
yarn test-unit --watchAll=false
DATABASE_URL=postgres://solpg:solpg@localhost:5432/solpg yarn test-api
yarn build-fast
```

Expected: all five pass. Report the actual output; do not claim completion without it.

- [x] **Step 7: Format, then hand over**

```sh
yarn format
```

Report that the work is complete and verified, and stop. Opening the PR is the owner's, below.

**For the owner to run when ready** (not a task step — commits, pushes and PRs are yours):

```sh
git add -A
git commit
git push -u origin saving-chats-history
gh pr create --base master-2.0 --title "feat(client-v2): persist conversations and code in Postgres"
```

Suggested PR description, for the owner to use or edit — it should carry: what shipped, the read-only-history limitation on restored threads, that program keypairs are synced deliberately, that `/api/agent` is still ungated, and that signed-in E2E coverage is missing. End it with the attribution line from the Global Constraints.

---

## Deferred: migrations machinery review

**Task 15 landed the "migrations run automatically in CI" half**: the workflow
now starts a `postgres:16` service, installs a pinned dbmate, runs
`yarn db-migrate` from scratch, and runs `yarn test-api` against it. What is
still outstanding is the freshness assertion below -- CI does not yet check
that `db/schema.sql` matches the migrations. Note that `yarn db-dump` shells
into the compose container, which does not exist on a CI runner, so that check
needs a different route to `pg_dump` (a `postgresql-client-16` on the runner,
or `docker exec` against the service container).


Raised 2026-09-16, explicitly **after** this plan is implemented — it is not
part of any task below, and must not expand their scope.

Review the whole migration machinery so it runs smoothly in development and CI:

- Every PR touching `client-v2/db/migrations/` must **assert `db/schema.sql`
  was regenerated** — fail when the checked-in dump does not match what the
  migrations produce.
- **Migrations must run automatically in the CI pipeline**, not by hand.
- Treat both as the seed of a broader audit rather than the whole of it.

Where it stands today: `schema.sql` comes from `yarn db-dump`, which runs
`pg_dump` inside the compose `postgres` container because the repo needs no
host Postgres client; `yarn db-migrate` passes `--no-dump-schema` so dbmate
never reaches for a host `pg_dump`. CI does not touch the database yet. Task 15
is the CI task and is the natural place for part of this to land.

---

## Self-review notes

**Spec coverage.** Every section of `docs/persistent-conversations-spec.md` maps to a task: identity → 3, 4; runtime and data access → 1, 2; storage model → 9, 13; conversations → 6, 8, 9, 10, 11, 13; code → 12, 14; project identity and lifecycle → 7, 12; UI → 10, 14; shipping → 1, 15. The one spec item deliberately carried as a **gap, not a task**, is signed-in E2E coverage, stated in Task 15 Step 4.

**Known soft spots for the executor.**
- Task 3 pins behaviour the `better-auth` package owns. Its Step 1 requires verifying the API surface before writing code; if it differs, adapt and say so rather than forcing the code below into shape.
- Task 9's tests drive real lightning-fs, which needs `fake-indexeddb/auto` under jsdom. Its Step 1 says to add that dev dependency if the suite reports `indexedDB is not defined`. Task 9 also makes every storage call asynchronous, which is why `PgAssistant.loadThread` is async and guards against a project switch landing mid-read.
- Task 14 references `PgExplorer.getCanonicalPath` and theme tokens that must be confirmed against the real files before use.
- Task 7 changes a file every existing user has on disk. Its Step 10 is a manual check and must not be skipped.
