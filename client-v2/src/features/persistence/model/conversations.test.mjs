import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { query } from "./db.mjs";
import {
  appendMessages,
  getThread,
  listMessages,
  listThreads,
  NotYours,
  ThreadDeleted,
} from "./conversations.mjs";
import { deleteProject } from "./projects.mjs";

// `yarn test-api` loads `.env`; without a database this suite skips rather
// than fails, which is what lets the unit suites run on their own.
const DB = process.env.DATABASE_URL;

describe("conversations", { skip: !DB && "DATABASE_URL not set" }, () => {
  const userId = "test-user";
  // A second account, needed by the cases below that write as somebody else.
  // A read can name a user that does not exist; a write cannot, because
  // `projects.user_id` is a foreign key into "user".
  const other = "test-user-2";

  /** A thread id, minted the way the client mints one */
  const thread = (n) =>
    `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`;

  /** The shape `appendMessages` takes: which thread, on which workspace */
  const on = (n, extra = {}) => ({
    threadId: thread(n),
    projectId: "p1",
    ...extra,
  });

  before(async () => {
    for (const [id, email] of [
      [userId, "test@example.com"],
      [other, "other@example.com"],
    ]) {
      await query(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, 'Test', $2, false, now(), now())
         on conflict (id) do nothing`,
        [id, email]
      );
    }
  });

  beforeEach(async () => {
    await query("delete from projects where user_id = any($1)", [
      [userId, other],
    ]);
  });

  const item = (n) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    kind: "user",
    createdAt: new Date(n * 1000).toISOString(),
    text: `m${n}`,
  });

  it("returns an empty thread for an unknown id", async () => {
    assert.deepEqual(await listMessages(userId, thread(9)), []);
  });

  it("creates the project and the thread on first append", async () => {
    await appendMessages(userId, on(1), [item(1)]);
    const items = await listMessages(userId, thread(1));
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "m1");
  });

  it("is idempotent, so a repeated dump changes nothing", async () => {
    await appendMessages(userId, on(1), [item(1), item(2)]);
    await appendMessages(userId, on(1), [item(1), item(2)]);
    assert.equal((await listMessages(userId, thread(1))).length, 2);
  });

  // Items change after they are created: a reply streams in, an approval is
  // answered. The server used to keep whichever copy of an id arrived first,
  // so a reply pushed mid-stream was what the account held for ever.
  describe("a message that changed after it was pushed", () => {
    const id = "00000000-0000-4000-8000-0000000000bb";
    const createdAt = new Date(1000).toISOString();

    /** One reply, as it stood at second `at`; no stamp is the unchanged one */
    const replyAt = (text, at) => ({
      id,
      kind: "assistant",
      createdAt,
      text,
      ...(at ? { updatedAt: new Date(at * 1000).toISOString() } : {}),
    });

    const stored = async () => {
      const items = await listMessages(userId, thread(1));
      assert.equal(items.length, 1);
      return items[0];
    };

    it("replaces a partial reply with the finished one", async () => {
      assert.equal(await appendMessages(userId, on(1), [replyAt("Do", 2)]), 1);
      assert.equal(
        await appendMessages(userId, on(1), [replyAt("Done.", 5)]),
        1,
        "the replacement counts as written"
      );

      assert.equal((await stored()).text, "Done.");
    });

    it("keeps the newer copy when a stale one arrives after it", async () => {
      // The device that pulled the partial reply, running its sign-in dump
      await appendMessages(userId, on(1), [replyAt("Done.", 5)]);

      assert.equal(await appendMessages(userId, on(1), [replyAt("Do", 2)]), 0);
      assert.equal((await stored()).text, "Done.");
    });

    it("writes nothing for an identical re-push", async () => {
      await appendMessages(userId, on(1), [replyAt("Done.", 5)]);

      assert.equal(
        await appendMessages(userId, on(1), [replyAt("Done.", 5)]),
        0
      );
    });

    it("falls back to createdAt for a copy that was never stamped", async () => {
      // Old data has no `updatedAt`. Its version is its creation, which any
      // later change is stamped after -- and an unstamped copy arriving
      // after a stamped one is the older of the two.
      await appendMessages(userId, on(1), [replyAt("")]);
      assert.equal(await appendMessages(userId, on(1), [replyAt("Hi", 2)]), 1);
      assert.equal((await stored()).text, "Hi");

      assert.equal(await appendMessages(userId, on(1), [replyAt("")]), 0);
      assert.equal((await stored()).text, "Hi");
    });

    it("compares versions as times, not as strings", async () => {
      // Equal instants, spelled differently: a string comparison calls the
      // second newer and rewrites the row
      await appendMessages(userId, on(1), [
        { ...replyAt("first"), updatedAt: "2026-01-01T10:00:00.000Z" },
      ]);

      assert.equal(
        await appendMessages(userId, on(1), [
          { ...replyAt("second"), updatedAt: "2026-01-01T11:00:00.000+01:00" },
        ]),
        0
      );
      assert.equal((await stored()).text, "first");
    });

    it("leaves the creation time, and so the order, alone", async () => {
      await appendMessages(userId, on(1), [replyAt("Do", 2)]);
      await appendMessages(userId, on(1), [replyAt("Done.", 5)]);

      const { rows } = await query(
        "select created_at from messages where id = $1",
        [id]
      );
      assert.equal(rows[0].created_at.toISOString(), createdAt);
    });

    it("takes the newest of two copies sent in one batch", async () => {
      // A hand-edited thread can hold an id twice, and an upsert may not
      // touch one row twice in a statement
      assert.equal(
        await appendMessages(userId, on(1), [
          replyAt("Do", 2),
          replyAt("Done.", 5),
        ]),
        1
      );
      assert.equal((await stored()).text, "Done.");
    });

    it("treats two spellings of one uuid in a batch as one item", async () => {
      // The insert casts to `uuid`, which ignores case, so a dedupe keyed on
      // the raw string let both through to one row and the statement failed
      assert.equal(
        await appendMessages(userId, on(1), [
          { ...replyAt("Do", 2), id: id.toUpperCase() },
          replyAt("Done.", 5),
        ]),
        1
      );
      assert.equal((await stored()).text, "Done.");
    });

    it("refuses a version Postgres cannot read before storing it", async () => {
      // `Date.parse` rolls this over to March; `timestamptz` refuses it. Cast
      // only on conflict, it was stored on first insert, and every later
      // push touching the row failed on it.
      const odd = {
        id,
        kind: "assistant",
        createdAt,
        text: "Do",
        updatedAt: "February 30, 2026",
      };
      assert.ok(!Number.isNaN(Date.parse(odd.updatedAt)));

      await assert.rejects(() => appendMessages(userId, on(1), [odd]));
      assert.deepEqual(await listMessages(userId, thread(1)), []);
    });

    it("never updates the same id in somebody else's thread", async () => {
      await appendMessages(userId, on(1), [replyAt("mine", 2)]);
      await appendMessages(other, { threadId: thread(2), projectId: "p1" }, [
        replyAt("theirs", 9),
      ]);

      assert.equal((await stored()).text, "mine");
      await assert.rejects(
        () => appendMessages(other, on(1), [replyAt("theirs", 9)]),
        NotYours
      );
      assert.equal((await stored()).text, "mine");
    });
  });

  it("orders by creation time, then id", async () => {
    await appendMessages(userId, on(1), [item(3), item(1), item(2)]);
    const items = await listMessages(userId, thread(1));
    assert.deepEqual(
      items.map((i) => i.text),
      ["m1", "m2", "m3"]
    );
  });

  it("does not leak another user's thread", async () => {
    await appendMessages(userId, on(1), [item(1)]);
    assert.deepEqual(await listMessages(other, thread(1)), []);
  });

  it("refuses to append to a thread id that is somebody else's", async () => {
    await appendMessages(userId, on(1), [item(1)]);

    await assert.rejects(
      () => appendMessages(other, on(1), [item(2)]),
      NotYours
    );
    // And the owner's thread is untouched by the attempt
    assert.equal((await listMessages(userId, thread(1))).length, 1);
  });

  describe("a thread whose project was deleted", () => {
    // A deleted project's threads are tombstoned with it, and every read
    // filters them out. Accepting a push anyway answered 200 for messages no
    // device could ever read back -- and a client deletes its own copy of a
    // thread on exactly that answer.
    it("refuses to add to it, and writes nothing", async () => {
      await appendMessages(userId, on(1), [item(1)]);
      await deleteProject(userId, "p1");

      await assert.rejects(
        () => appendMessages(userId, on(1), [item(2)]),
        (e) => e instanceof ThreadDeleted && e.scope === "project"
      );
      const { rows } = await query(
        "select count(*)::int as n from messages where conversation_id = $1",
        [thread(1)]
      );
      assert.equal(rows[0].n, 1);
    });

    it("names the thread when only the thread is gone", async () => {
      // A tutorial started again: the project row is live, the previous
      // run's conversation is not. The client replaces such a thread on the
      // spot, which is why it has to be told which tombstone it hit.
      await appendMessages(userId, on(1), [item(1)]);
      await query("update conversations set deleted_at = now() where id = $1", [
        thread(1),
      ]);

      await assert.rejects(
        () => appendMessages(userId, on(1), [item(2)]),
        (e) => e instanceof ThreadDeleted && e.scope === "thread"
      );
    });

    it("refuses a new thread under it, before creating one", async () => {
      // The project insert is `on conflict do nothing`, so a tombstone stays
      // one -- and a thread row inserted beneath it would be a live thread
      // on a dead project, which the next list by project would hand out
      await appendMessages(userId, on(1), [item(1)]);
      await deleteProject(userId, "p1");

      await assert.rejects(
        () => appendMessages(userId, on(2), [item(2)]),
        ThreadDeleted
      );
      const { rows } = await query(
        "select count(*)::int as n from conversations where id = $1",
        [thread(2)]
      );
      assert.equal(rows[0].n, 0);
    });

    it("refuses a scope the client would not know", async () => {
      // `scope` goes on the wire and the client drops its copy on one of
      // its values, so a typo has to fail here rather than pick a branch
      assert.throws(() => new ThreadDeleted("conversation"), TypeError);
    });

    it("still answers a stranger's thread id as not yours", async () => {
      // The ownership check comes first: confirming that somebody else's
      // thread was deleted would turn the refusal into an oracle for
      // guessed uuids
      await appendMessages(userId, on(1), [item(1)]);
      await deleteProject(userId, "p1");

      await assert.rejects(
        () =>
          appendMessages(other, { threadId: thread(1), projectId: "p9" }, [
            item(2),
          ]),
        NotYours
      );
    });
  });

  describe("a project holding more than one thread", () => {
    it("keeps them apart", async () => {
      await appendMessages(userId, on(1), [item(1)]);
      await appendMessages(userId, on(2), [item(2)]);

      assert.equal((await listMessages(userId, thread(1))).length, 1);
      assert.equal((await listMessages(userId, thread(2))).length, 1);
    });

    it("lists them newest first, without their messages", async () => {
      await appendMessages(userId, on(1), [item(1)]);
      await appendMessages(userId, on(2), [item(2)]);

      const threads = await listThreads(userId, "p1");
      assert.deepEqual(
        threads.map((t) => t.id),
        [thread(2), thread(1)]
      );
      assert.ok(!("items" in threads[0]));
    });

    it("lists nobody else's", async () => {
      await appendMessages(userId, on(1), [item(1)]);
      assert.deepEqual(await listThreads(other, "p1"), []);
    });
  });

  // The only record of which backend was involved. The thread row deliberately
  // holds none: a user switches models inside one conversation, so a single
  // backend recorded against the thread would be untrue for most of them.
  it("stores the backend each reply came from, inside the message", async () => {
    const reply = {
      id: "00000000-0000-4000-8000-0000000000aa",
      kind: "assistant",
      createdAt: new Date(2000).toISOString(),
      text: "hello",
      origin: { provider: "default", model: "some-model" },
    };
    await appendMessages(userId, on(1), [reply]);

    const [stored] = await listMessages(userId, thread(1));
    assert.deepEqual(stored.origin, {
      provider: "default",
      model: "some-model",
    });

    const row = await getThread(userId, thread(1));
    for (const column of ["provider", "model", "baseUrl", "effort"]) {
      assert.ok(!(column in row), `${column} must not be on the thread`);
    }
  });

  // Ids are minted by the client, so two threads holding the same one is a
  // thing the server has to survive rather than a thing it can rule out. Under
  // the original global `messages.id` primary key the second insert hit
  // `on conflict do nothing` and was dropped -- while the route still reported
  // success, so the message was lost with nothing said about it.
  it("keeps the same client-minted id in two of one user's threads", async () => {
    await appendMessages(userId, on(1), [item(1)]);
    await appendMessages(userId, on(2), [item(1)]);

    assert.equal((await listMessages(userId, thread(1))).length, 1);
    assert.equal((await listMessages(userId, thread(2))).length, 1);
  });

  // The same collision across accounts, which is the reachable half: one user
  // can choose an id another user already posted. Both messages survive, and
  // the count returned for the second write is 1 -- it must not double as an
  // answer to "does this id exist in somebody else's thread".
  it("keeps the same client-minted id across two accounts", async () => {
    // Two threads, because a thread id is global: pushing into somebody
    // else's is `NotYours`, which is a different test. What is shared here is
    // the *message* id, which is the one a client actually chooses.
    assert.equal(await appendMessages(userId, on(1), [item(1)]), 1);
    assert.equal(
      await appendMessages(other, { threadId: thread(2), projectId: "p1" }, [
        item(1),
      ]),
      1
    );

    assert.equal((await listMessages(userId, thread(1))).length, 1);
    assert.equal((await listMessages(other, thread(2))).length, 1);
  });
});
