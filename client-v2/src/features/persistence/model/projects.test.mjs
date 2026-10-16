import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import {
  appendMessages,
  getThread,
  listThreads,
  ThreadDeleted,
} from "./conversations.mjs";
import { query, transaction } from "./db.mjs";
import {
  deleteProject,
  getProject,
  listProjects,
  saveProject,
  writeProject,
} from "./projects.mjs";

// `yarn test-api` loads `.env`; without a database this suite skips rather
// than fails, which is what lets the unit suites run on their own.
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
    await query("delete from conversations where user_id = $1", [userId]);
    await query("delete from projects where user_id = $1", [userId]);
  });

  const files = { "src/lib.rs": "fn main() {}", "Cargo.toml": "[package]" };

  /** One project, `p1`, written in whichever mode the case names */
  const put = (input) =>
    saveProject(userId, { id: "p1", name: "one", kind: "project", ...input });

  /** Row versions, so a case can tell a rewritten row from an untouched one */
  const versions = async () => {
    const { rows } = await query(
      `select path, xmin::text as version from project_files
        where user_id = $1 and project_id = 'p1' order by path`,
      [userId]
    );
    return Object.fromEntries(rows.map((r) => [r.path, r.version]));
  };

  it("saves a whole file set and reads it back", async () => {
    await put({ files });
    assert.deepEqual((await getProject(userId, "p1")).snapshot, { files });
  });

  it("reads a project with no files as having no snapshot", async () => {
    await query(
      `insert into projects (id, user_id, name, kind) values ('p1', $1, 'p1', 'project')`,
      [userId]
    );
    assert.equal((await getProject(userId, "p1")).snapshot, null);
  });

  it("accepts a swap that carries the current updatedAt", async () => {
    const first = await put({ files });
    const second = await put({ files, baseUpdatedAt: first.updatedAt });
    assert.ok(second.updatedAt);
    assert.notEqual(second.conflict, true);
  });

  it("refuses a write built on a stale read, and changes nothing", async () => {
    await put({ files });
    const result = await put({
      changed: { "src/lib.rs": "stale" },
      removed: [],
      baseUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    assert.equal(result.conflict, true);
    assert.deepEqual((await getProject(userId, "p1")).snapshot, { files });
  });

  it("hands back a token the client can retry with", async () => {
    await put({ files });
    const stale = await put({
      files,
      baseUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    assert.equal(stale.conflict, true);

    const retry = await put({
      files,
      name: "two",
      baseUpdatedAt: stale.updatedAt,
    });
    assert.notEqual(retry.conflict, true);
    assert.equal((await getProject(userId, "p1")).name, "two");
  });

  it("patches only the files named, and removes the ones listed", async () => {
    const first = await put({ files: { ...files, "old.rs": "gone soon" } });
    await put({
      changed: { "src/lib.rs": "fn main() { edited }", "new.rs": "added" },
      removed: ["old.rs"],
      baseUpdatedAt: first.updatedAt,
    });
    assert.deepEqual((await getProject(userId, "p1")).snapshot, {
      files: {
        "src/lib.rs": "fn main() { edited }",
        "Cargo.toml": "[package]",
        "new.rs": "added",
      },
    });
  });

  it("leaves the rows a patch does not name unwritten", async () => {
    // The point of the table: an edit to one file costs one row
    const first = await put({ files });
    const before = await versions();
    await put({
      changed: { "src/lib.rs": "edited" },
      removed: [],
      baseUpdatedAt: first.updatedAt,
    });
    const after = await versions();
    assert.equal(after["Cargo.toml"], before["Cargo.toml"]);
    assert.notEqual(after["src/lib.rs"], before["src/lib.rs"]);
  });

  it("creates a template-sized project in two statements, not one per file", async () => {
    // Counted through the real database: a regression to per-file inserts
    // would still pass every other case here, just slowly
    const statements = [];
    const counting = (text, params) => {
      statements.push(text);
      return query(text, params);
    };
    const many = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`src/file${i}.rs`, `// ${i}`])
    );

    const created = await writeProject(counting, userId, {
      id: "p1",
      name: "one",
      kind: "project",
      files: many,
    });
    assert.equal(statements.length, 2);
    assert.equal(
      Object.keys((await getProject(userId, "p1")).snapshot.files).length,
      200
    );

    statements.length = 0;
    await writeProject(counting, userId, {
      id: "p1",
      name: "one",
      kind: "project",
      changed: { "src/file7.rs": "edited" },
      removed: ["src/file8.rs"],
      baseUpdatedAt: created.updatedAt,
    });
    assert.ok(statements.length <= 3);
  });

  it("replaces the file set on a full swap, deleting what it omits", async () => {
    const first = await put({ files });
    await put({
      files: { "src/lib.rs": "only" },
      baseUpdatedAt: first.updatedAt,
    });
    assert.deepEqual((await getProject(userId, "p1")).snapshot, {
      files: { "src/lib.rs": "only" },
    });
  });

  it("does not rewrite unchanged rows on a full swap", async () => {
    const first = await put({ files });
    const before = await versions();
    await put({
      files: { ...files, "src/lib.rs": "edited" },
      baseUpdatedAt: first.updatedAt,
    });
    assert.equal((await versions())["Cargo.toml"], before["Cargo.toml"]);
  });

  it("refuses to clobber an existing project when no token is offered", async () => {
    await put({ files });
    const result = await put({ files: { "src/lib.rs": "someone else" } });
    assert.equal(result.conflict, true);
    assert.deepEqual((await getProject(userId, "p1")).snapshot, { files });
  });

  it("adopts a row a conversation created, rather than refusing it", async () => {
    // `ensureConversation` inserts a parent `projects` row so a chat turn has
    // somewhere to hang, with no files at all. The project's own first push
    // carries no token and takes the create-only branch.
    await query(
      `insert into projects (id, user_id, name, kind) values ('p1', $1, 'p1', 'project')`,
      [userId]
    );
    const result = await put({ files });
    assert.notEqual(result.conflict, true);
    const project = await getProject(userId, "p1");
    assert.deepEqual(project.snapshot, { files });
    assert.equal(project.name, "one");
  });

  it("does not adopt a tombstoned row, and says why it refused", async () => {
    // A tombstone has no files either, so "no files" alone would make every
    // delete undoable by any device that had not seen it. The refusal names
    // the tombstone: without `reason` it read as a version conflict, and the
    // client asked "keep this version or take the other?" about a project
    // with no other version to take.
    await put({ files });
    await deleteProject(userId, "p1");
    const result = await put({ files });
    assert.equal(result.conflict, true);
    assert.equal(result.reason, "deleted");
    assert.equal(await getProject(userId, "p1"), null);
  });

  it("says a missed swap hit a tombstone, not a newer version", async () => {
    const first = await put({ files });
    await deleteProject(userId, "p1");

    const result = await put({ files, baseUpdatedAt: first.updatedAt });

    assert.equal(result.conflict, true);
    assert.equal(result.reason, "deleted");
    assert.equal(result.updatedAt, null);
  });

  it("gives a plain version conflict no reason", async () => {
    await put({ files });

    const result = await put({
      files,
      baseUpdatedAt: "2000-01-01T00:00:00.000Z",
    });

    assert.equal(result.conflict, true);
    assert.equal(result.reason, undefined);
  });

  describe("a tutorial deleted and started again", () => {
    // A tutorial's id is derived from its name, so starting one again after
    // a delete can only ever arrive at the tombstone
    const tutorial = ({ files, baseUpdatedAt }) =>
      saveProject(userId, {
        id: "tut:hello",
        name: "Hello",
        kind: "tutorial",
        files,
        baseUpdatedAt,
      });

    it("starts again under its own id", async () => {
      await tutorial({ files });
      await deleteProject(userId, "tut:hello");

      const fresh = { "src/lib.rs": "fresh start" };
      const result = await tutorial({ files: fresh });

      assert.notEqual(result.conflict, true);
      assert.ok(result.updatedAt);
      assert.deepEqual((await getProject(userId, "tut:hello")).snapshot, {
        files: fresh,
      });
      assert.deepEqual(
        (await listProjects(userId)).map((p) => p.id),
        ["tut:hello"]
      );
    });

    it("does not start again over a stale token", async () => {
      // Only the create-only door restarts one: a token means the caller had
      // the old run synced, which is the device that has to be told
      const first = await tutorial({ files });
      await deleteProject(userId, "tut:hello");

      const result = await tutorial({ files, baseUpdatedAt: first.updatedAt });

      assert.equal(result.conflict, true);
      assert.equal(result.reason, "deleted");
      assert.equal(await getProject(userId, "tut:hello"), null);
    });

    it("does not revive a deleted personal project the same way", async () => {
      // The door is keyed on the kind the row holds and the kind the write
      // names, and a personal project's id is a uuid nothing re-derives
      await put({ files });
      await deleteProject(userId, "p1");

      const result = await saveProject(userId, {
        id: "p1",
        name: "one",
        kind: "tutorial",
        files,
      });

      assert.equal(result.conflict, true);
      assert.equal(result.reason, "deleted");
    });

    it("leaves the previous run's conversation deleted", async () => {
      // Deliberate: the conversations went with the delete, and bringing
      // them back would hand the new run the old run's chat -- the bug the
      // tombstoning exists to stop. A device still holding the old thread is
      // told 410 on its next push and starts a new one.
      const threadId = "22222222-0000-4000-8000-000000000002";
      await tutorial({ files });
      await appendMessages(userId, { threadId, projectId: "tut:hello" }, [
        {
          id: "22222222-0000-4000-8000-000000000102",
          kind: "user",
          createdAt: new Date(1000).toISOString(),
          text: "old run",
        },
      ]);
      await deleteProject(userId, "tut:hello");

      await tutorial({ files });

      assert.deepEqual(await listThreads(userId, "tut:hello"), []);
      assert.equal(await getThread(userId, threadId), null);
      // The device still holding the old thread is told so, and told that
      // only the thread is gone -- the project it pushes to is live again
      await assert.rejects(
        () =>
          appendMessages(userId, { threadId, projectId: "tut:hello" }, [
            {
              id: "22222222-0000-4000-8000-000000000103",
              kind: "user",
              createdAt: new Date(2000).toISOString(),
              text: "still here?",
            },
          ]),
        (e) => e instanceof ThreadDeleted && e.scope === "thread"
      );
    });
  });

  it("deletes only that project's conversations", async () => {
    // Scoped by user and project in the statement itself: a delete that
    // tombstoned by project id alone would take the same tutorial's chat
    // from every account that started it
    const otherUser = "test-user-projects-2";
    await query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Test', 'projects-2@example.com', false, now(), now())
       on conflict (id) do nothing`,
      [otherUser]
    );
    await query("delete from projects where user_id = $1", [otherUser]);
    const mine = "22222222-0000-4000-8000-000000000011";
    const neighbour = "22222222-0000-4000-8000-000000000012";
    const theirs = "22222222-0000-4000-8000-000000000013";
    const message = (n) => ({
      id: `22222222-0000-4000-8000-0000000001${n}`,
      kind: "user",
      createdAt: new Date(1000).toISOString(),
      text: "hi",
    });
    await appendMessages(userId, { threadId: mine, projectId: "tut:hello" }, [
      message(11),
    ]);
    await appendMessages(userId, { threadId: neighbour, projectId: "p2" }, [
      message(12),
    ]);
    await appendMessages(
      otherUser,
      { threadId: theirs, projectId: "tut:hello" },
      [message(13)]
    );

    await deleteProject(userId, "tut:hello");

    assert.equal(await getThread(userId, mine), null);
    assert.ok(await getThread(userId, neighbour));
    assert.ok(await getThread(otherUser, theirs));
  });

  it("tombstones rather than deleting, and drops the files", async () => {
    await put({ files });
    await deleteProject(userId, "p1");

    assert.equal(await getProject(userId, "p1"), null);
    const { rows } = await query(
      "select deleted_at from projects where id = 'p1' and user_id = $1",
      [userId]
    );
    assert.ok(rows[0].deleted_at);
    assert.deepEqual(await versions(), {});
  });

  it("omits tombstoned projects from the list", async () => {
    await put({ files });
    await saveProject(userId, {
      id: "p2",
      name: "two",
      kind: "project",
      files,
    });
    await deleteProject(userId, "p1");
    assert.deepEqual(
      (await listProjects(userId)).map((p) => p.id),
      ["p2"]
    );
  });

  it("refuses a create that races another first upload, and keeps one file set", async () => {
    // Two devices uploading a brand-new project at once. B blocks on A's
    // uncommitted row; when A commits, B's create-only insert must be refused,
    // not adopt A's row and merge its files into A's.
    const filesA = { "a.rs": "from A" };
    const filesB = { "b.rs": "from B" };
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let aWritten;
    const written = new Promise((resolve) => (aWritten = resolve));

    const a = transaction(async (q) => {
      await writeProject(q, userId, {
        id: "p1",
        name: "one",
        kind: "project",
        files: filesA,
      });
      aWritten();
      await gate;
    });
    await written;

    const b = put({ files: filesB });

    // Polled rather than slept: B is ready once Postgres reports it waiting
    // on a lock, which is the state this case needs it in
    for (let i = 0; i < 100; i++) {
      const { rows } = await query(
        `select 1 from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`
      );
      if (rows.length) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    release();
    const [, result] = await Promise.all([a, b]);
    assert.equal(result.conflict, true);
    assert.deepEqual((await getProject(userId, "p1")).snapshot, {
      files: filesA,
    });
  });

  it("frees the name for reuse once tombstoned", async () => {
    await put({ files });
    await deleteProject(userId, "p1");
    const again = await saveProject(userId, {
      id: "p2",
      name: "one",
      kind: "project",
      files,
    });
    assert.ok(again.updatedAt);
  });
});
