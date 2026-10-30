import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import pg from "pg";

import {
  appendMessages,
  getThread,
  listThreads,
  ThreadDeleted,
} from "./conversations.mjs";
import { query, transaction } from "./db.mjs";
import { NO_FILES_REASON } from "./project-write.mjs";
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

  it("refuses a patch that removes every file, and changes nothing", async () => {
    // Once a row holds no files, every other device reads it as no snapshot
    // and can neither adopt it nor merge with it
    const first = await put({ files });
    const result = await put({
      changed: {},
      removed: Object.keys(files),
      baseUpdatedAt: first.updatedAt,
    });
    assert.deepEqual(result, { refused: NO_FILES_REASON });
    const after = await getProject(userId, "p1");
    assert.deepEqual(after.snapshot, { files });
    assert.equal(after.updatedAt, first.updatedAt);
  });

  it("takes a patch that only removes a file, keeping the rest", async () => {
    // The common delete-one-file push, which reaches the emptiness check
    const first = await put({
      files: {
        "src/lib.rs": "fn main() {}",
        "Cargo.toml": "[package]",
        "old.rs": "gone soon",
      },
    });
    const result = await put({
      changed: {},
      removed: ["old.rs", "never-there.rs"],
      baseUpdatedAt: first.updatedAt,
    });
    assert.ok(result.updatedAt);
    assert.deepEqual((await getProject(userId, "p1")).snapshot, { files });
  });

  it("answers a stale emptying patch with the conflict, not the refusal", async () => {
    // The conflict carries the token the client retries with; the refusal
    // carries none
    await put({ files });
    const result = await put({
      changed: {},
      removed: Object.keys(files),
      baseUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    assert.equal(result.conflict, true);
    assert.ok(result.updatedAt);
    assert.deepEqual((await getProject(userId, "p1")).snapshot, { files });
  });

  it("takes a patch that removes every file and adds another", async () => {
    const first = await put({ files });
    const result = await put({
      changed: { "src/main.rs": "fn main() {}" },
      removed: Object.keys(files),
      baseUpdatedAt: first.updatedAt,
    });
    assert.ok(result.updatedAt);
    assert.deepEqual((await getProject(userId, "p1")).snapshot, {
      files: { "src/main.rs": "fn main() {}" },
    });
  });

  it("refuses an empty patch against a row that has no files", async () => {
    // The parent row a chat turn creates holds no files; a patch adding
    // nothing to it would bump its token over an empty project
    await query(
      `insert into projects (id, user_id, name, kind) values ('p1', $1, 'one', 'project')`,
      [userId]
    );
    const { updatedAt } = await getProject(userId, "p1");
    const result = await put({
      changed: {},
      removed: [],
      baseUpdatedAt: updatedAt,
    });
    assert.deepEqual(result, { refused: NO_FILES_REASON });
    assert.equal((await getProject(userId, "p1")).updatedAt, updatedAt);
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

  describe("erasing a deleted project's history", () => {
    // The tombstone hides a thread from every read; the content under it
    // must go too, or a deleted project's chat outlives the delete in the
    // account. Read straight from the tables: no API returns a tombstoned
    // thread, so only the rows can show what is left.
    const otherUser = "test-user-projects-2";

    /** What the database still holds of one thread */
    const left = async (threadId) => {
      const { rows } = await query(
        `select c.title, c.deleted_at is not null as deleted,
                (select count(*)::int from messages m
                  where m.conversation_id = c.id) as messages
           from conversations c where c.id = $1`,
        [threadId]
      );
      return rows[0];
    };

    const say = (userOf, threadId, projectId, n) =>
      appendMessages(userOf, { threadId, projectId, title: `chat ${n}` }, [
        {
          id: `22222222-0000-4000-8000-0000000002${n}`,
          kind: "user",
          createdAt: new Date(1000).toISOString(),
          text: "hi",
        },
      ]);

    before(async () => {
      await query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, 'Test', 'projects-2@example.com', false, now(), now())
         on conflict (id) do nothing`,
        [otherUser]
      );
    });

    beforeEach(async () => {
      await query("delete from conversations where user_id = $1", [otherUser]);
      await query("delete from projects where user_id = $1", [otherUser]);
    });

    it("deletes its messages and title, keeping the tombstone", async () => {
      const mine = "22222222-0000-4000-8000-000000000021";
      await say(userId, mine, "p1", 21);

      await deleteProject(userId, "p1");

      assert.deepEqual(await left(mine), {
        title: null,
        deleted: true,
        messages: 0,
      });
    });

    it("leaves another project's history whole", async () => {
      const neighbour = "22222222-0000-4000-8000-000000000022";
      await say(userId, "22222222-0000-4000-8000-000000000023", "p1", 23);
      await say(userId, neighbour, "p2", 22);

      await deleteProject(userId, "p1");

      assert.deepEqual(await left(neighbour), {
        title: "chat 22",
        deleted: false,
        messages: 1,
      });
    });

    it("leaves another account's history under the same id whole", async () => {
      // A tutorial's id is the same string in every account that started it
      const theirs = "22222222-0000-4000-8000-000000000024";
      await say(userId, "22222222-0000-4000-8000-000000000025", "tut:x", 25);
      await say(otherUser, theirs, "tut:x", 24);

      await deleteProject(userId, "tut:x");

      assert.deepEqual(await left(theirs), {
        title: "chat 24",
        deleted: false,
        messages: 1,
      });
    });

    it("also erases a thread tombstoned before this delete", async () => {
      // A tutorial restarted after a delete leaves the old run's thread
      // tombstoned under a live project id; the next delete takes it too
      const earlier = "22222222-0000-4000-8000-000000000026";
      await say(userId, earlier, "p1", 26);
      await query("update conversations set deleted_at = now() where id = $1", [
        earlier,
      ]);

      await deleteProject(userId, "p1");

      assert.deepEqual(await left(earlier), {
        title: null,
        deleted: true,
        messages: 0,
      });
    });

    it("erases a push that was in flight when the delete came", async () => {
      // A push that has found its thread live and is still writing when the
      // delete runs must either finish before the erase or be refused; its
      // messages must never land under the tombstone afterwards. The push is
      // held mid-write by an open transaction that inserted the same message
      // id first, so the delete runs while the push is past its checks.
      const threadId = "22222222-0000-4000-8000-000000000027";
      const held = {
        id: "22222222-0000-4000-8000-000000000327",
        kind: "user",
        createdAt: new Date(2000).toISOString(),
        text: "in flight",
      };
      await say(userId, threadId, "p1", 27);
      let push;
      let deletion;

      // Its own connection, outside the pool: the pool holds three, and the
      // push and the delete take two of them while this one must keep
      // polling and keep its transaction open
      const side = new pg.Client({ connectionString: DB });
      await side.connect();
      try {
        /** Sessions of this database waiting on a lock */
        const waiting = async () => {
          const { rows } = await side.query(
            `select count(*)::int as n from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock'`
          );
          return rows[0].n;
        };
        const until = async (done) => {
          for (let i = 0; i < 100 && !(await done()); i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        };

        // Holds the push mid-write: it inserts the push's message id first,
        // so the push waits on this row until the rollback below
        await side.query("begin");
        await side.query(
          `insert into messages (id, conversation_id, kind, payload, created_at)
           values ($1, $2, 'user', '{}', now())`,
          [held.id, threadId]
        );

        push = appendMessages(userId, { threadId, projectId: "p1" }, [
          held,
        ]).catch((e) => e);
        await until(async () => (await waiting()) >= 1);

        let deleted = false;
        deletion = deleteProject(userId, "p1").then(() => (deleted = true));
        await until(async () => deleted || (await waiting()) >= 2);
      } finally {
        await side.query("rollback");
        await side.end();
      }
      const pushed = await push;
      await deletion;

      if (pushed instanceof Error) {
        assert.ok(pushed instanceof ThreadDeleted, pushed.message);
      }
      assert.equal((await left(threadId)).messages, 0);
    });
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
