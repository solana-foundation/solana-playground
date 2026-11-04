import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  batchPush,
  batchPushWith,
  DELETED_REASON,
  MAX_BATCH_BYTES,
  MAX_BATCH_ITEMS,
} from "../src/features/persistence/server.mjs";

const load = async () => {
  // Fresh module per case: `db.mjs` memoises its pool at module scope
  const url = new URL("./conversations.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
};

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

describe("/api/conversations", () => {
  // Cleared before each case, not after: `yarn test-api` loads `.env`, so the
  // environment these cases assert is absent would otherwise be present.
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.SYNC_ENABLED;
    // Same reasoning, one gate further along: with a base URL set, the origin
    // check has something to compare against, and every case that sends no
    // `Origin` would be answering a question it is not asking.
    delete process.env.AUTH_BASE_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_BRANCH_URL;
  });

  /** Past the kill switch, so the case can assert on a later gate */
  const enableSync = () => {
    process.env.DATABASE_URL = "postgres://x/y";
    process.env.SYNC_ENABLED = "true";
  };

  /** Enough of the platform's request object for a body-less call */
  const makeReq = (over) => ({ method: "GET", url: "/", headers: {}, ...over });

  it("503s while the sync kill switch is off", async () => {
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/?projectId=p1", headers: {} },
      res
    );
    assert.equal(res.statusCode, 503);
  });

  it("401s when enabled but signed out", async () => {
    process.env.DATABASE_URL = "postgres://x/y";
    process.env.SYNC_ENABLED = "true";
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/?projectId=p1", headers: {} },
      res
    );
    assert.equal(res.statusCode, 401);
  });

  it("rejects an unsupported method before reaching the database", async () => {
    process.env.DATABASE_URL = "postgres://x/y";
    process.env.SYNC_ENABLED = "true";
    const mod = await load();
    const res = makeRes();
    await mod.default({ method: "DELETE", url: "/", headers: {} }, res);
    // Signed out first: the auth gate is deliberately ahead of the method check
    assert.equal(res.statusCode, 401);
  });

  describe("origin", () => {
    it("refuses a post from another origin", async () => {
      enableSync();
      process.env.AUTH_BASE_URL = "https://solpg.example";
      const mod = await load();
      const res = makeRes();
      await mod.default(
        makeReq({
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
        res
      );
      assert.equal(res.statusCode, 403);
    });

    it("lets our own origin through", async () => {
      enableSync();
      process.env.AUTH_BASE_URL = "https://solpg.example";
      const mod = await load();
      const res = makeRes();
      await mod.default(
        makeReq({
          method: "POST",
          headers: { origin: "https://solpg.example" },
        }),
        res
      );
      // 401, not 200: past the origin gate and stopped at auth, which is as
      // far as a direct call can go
      assert.equal(res.statusCode, 401);
    });

    it("checks nothing when there is no deployment origin to check", async () => {
      // No AUTH_BASE_URL and no Vercel hostname, which is local development
      enableSync();
      const mod = await load();
      const res = makeRes();
      await mod.default(
        makeReq({
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
        res
      );
      assert.equal(res.statusCode, 401);
    });
  });

  describe("describeFailure", () => {
    it("maps a thread that is somebody else's to 404", async () => {
      const mod = await load();
      const { NotYours } = await import(
        "../src/features/persistence/server.mjs"
      );

      const { status } = mod.describeFailure(new NotYours());

      assert.equal(status, 404);
    });

    it("maps a thread deleted under a live project to 410, not 2xx", async () => {
      // The client deletes its own copy of a thread once the server has
      // taken it, so a 200 here lost the messages; a 404 reads as transient,
      // so the thread would be pushed again on every turn
      const mod = await load();
      const { ThreadDeleted } = await import(
        "../src/features/persistence/server.mjs"
      );

      const { status, body } = mod.describeFailure(new ThreadDeleted("thread"));

      assert.equal(status, 410);
      assert.equal(body.reason, DELETED_REASON);
      assert.equal(body.scope, "thread");
    });

    it("says when it was the project that was deleted", async () => {
      // The client leaves such a thread for the user's answer about the
      // project, rather than replacing it on the spot
      const mod = await load();
      const { ThreadDeleted } = await import(
        "../src/features/persistence/server.mjs"
      );

      const { status, body } = mod.describeFailure(
        new ThreadDeleted("project")
      );

      assert.equal(status, 410);
      assert.equal(body.scope, "project");
    });

    it("keeps the driver's own text out of any other answer", async () => {
      const mod = await load();
      const { status, body } = mod.describeFailure(
        Object.assign(new Error('column "secret" does not exist'), {
          code: "42703",
        })
      );

      assert.equal(status, 500);
      assert.ok(!JSON.stringify(body).includes("secret"));
    });
  });

  describe("readBody", () => {
    /** A request body delivered as the platform delivers one */
    const streamOf = (...chunks) => ({
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    });

    it("tells a syntax error from an oversized body", async () => {
      // The two used to share a `try`, so malformed JSON came back as 413
      const mod = await load();
      assert.deepEqual(await mod.readBody(streamOf(Buffer.from("{oops"))), {
        error: "malformed",
      });
    });

    it("stops at the cap rather than buffering the whole body", async () => {
      const mod = await load();
      const mb = Buffer.alloc(1_000_000);
      const chunks = Array.from({ length: 3 }, () => mb);
      assert.deepEqual(await mod.readBody(streamOf(...chunks)), {
        error: "too-large",
      });
    });
  });

  describe("batchPush", () => {
    const streamOf = (text) => ({
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(text, "utf8");
      },
    });

    const envelope = {
      threadId: "6f1c1c1e-6f4b-4b55-9c1e-5c2d1b6a7e01",
      projectId: "w1",
    };

    /** A body as the client sends one: the envelope, then `items` last */
    const bodyOf = (items) =>
      JSON.stringify({
        threadId: envelope.threadId,
        projectId: envelope.projectId,
        items,
      });

    const weigh = (text) => Buffer.byteLength(text, "utf8");

    const idOf = (n) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

    const reply = (n, text) => ({
      id: idOf(n),
      kind: "assistant",
      createdAt: new Date(n * 1000).toISOString(),
      text,
    });

    /**
     * A long thread at its worst: the device keeps 200 items, and each one
     * carries text of a three-byte character, so the character counts on an
     * item say a third of what the wire carries.
     */
    const longThread = () =>
      Array.from({ length: 200 }, (_, n) => reply(n, "語".repeat(20_000)));

    const idsIn = (bodies) =>
      bodies.flatMap((b) => JSON.parse(b).items.map((i) => i.id));

    it("splits a thread the cap would refuse into bodies it takes", async () => {
      const mod = await load();
      const items = longThread();

      // The thread whole is what used to be sent, and it never got in
      assert.deepEqual(await mod.readBody(streamOf(bodyOf(items))), {
        error: "too-large",
      });

      const { bodies, oversized } = batchPush(envelope, items);

      assert.ok(bodies.length > 1);
      assert.deepEqual(oversized, []);
      for (const body of bodies) {
        const read = await mod.readBody(streamOf(body));
        assert.equal(read.error, undefined, "a batch got a 413");
        assert.equal(read.body.threadId, envelope.threadId);
        assert.equal(read.body.projectId, envelope.projectId);
        assert.ok(read.body.items.length <= MAX_BATCH_ITEMS);
        assert.ok(read.body.items.every(mod.isValidItem));
      }
      // Every item once, oldest first
      assert.deepEqual(
        idsIn(bodies),
        items.map((i) => i.id)
      );
    });

    it("measures what the wire carries, escapes and four-byte characters included", async () => {
      const mod = await load();
      // An escaped quote is two bytes for one character, an emoji four
      const items = Array.from({ length: 200 }, (_, n) =>
        reply(n, '"\n😀'.repeat(5_000))
      );

      const { bodies } = batchPush(envelope, items);

      for (const body of bodies) {
        assert.ok(weigh(body) <= MAX_BATCH_BYTES);
        assert.equal((await mod.readBody(streamOf(body))).error, undefined);
      }
      assert.equal(idsIn(bodies).length, 200);
    });

    it("fills a body to the byte, and one byte less splits it", () => {
      const items = longThread().slice(0, 4);
      // Room for exactly two items: the empty body, two items and one comma
      const two = weigh(bodyOf(items.slice(0, 2)));

      const exact = batchPushWith(two)(MAX_BATCH_ITEMS)(envelope, items).bodies;
      assert.equal(exact.length, 2);
      exact.forEach((b) => assert.equal(weigh(b), two));

      assert.equal(
        batchPushWith(two - 1)(MAX_BATCH_ITEMS)(envelope, items).bodies.length,
        4
      );
    });

    it("sends an item that fills a body alone, and leaves out one a byte larger", () => {
      const [item] = longThread();
      const alone = weigh(bodyOf([item]));

      assert.deepEqual(
        batchPushWith(alone)(MAX_BATCH_ITEMS)(envelope, [item]),
        {
          bodies: [bodyOf([item])],
          oversized: [],
        }
      );
      assert.deepEqual(
        batchPushWith(alone - 1)(MAX_BATCH_ITEMS)(envelope, [item]),
        {
          bodies: [bodyOf([])],
          oversized: [item.id],
        }
      );
    });

    it("lets a body of exactly the cap through the server", async () => {
      const mod = await load();
      const filler = MAX_BATCH_BYTES - weigh(bodyOf([reply(0, "")]));
      const body = bodyOf([reply(0, "x".repeat(filler))]);
      assert.equal(weigh(body), MAX_BATCH_BYTES);

      assert.equal((await mod.readBody(streamOf(body))).error, undefined);
    });

    it("caps the item count as the server does", () => {
      const items = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, n) =>
        reply(n, "m")
      );

      assert.deepEqual(
        batchPush(envelope, items).bodies.map(
          (b) => JSON.parse(b).items.length
        ),
        [MAX_BATCH_ITEMS, 1]
      );
    });

    it("leaves out an item no body can hold, and sends the rest", () => {
      const small = reply(0, "m");
      const big = reply(1, "語".repeat(MAX_BATCH_BYTES));
      const last = reply(2, "m");

      const { bodies, oversized } = batchPush(envelope, [small, big, last]);

      assert.deepEqual(oversized, [big.id]);
      assert.deepEqual(idsIn(bodies), [small.id, last.id]);
    });

    it("sends one empty body for a thread with nothing to send", () => {
      // The empty body is how the thread's row comes into being
      assert.deepEqual(batchPush(envelope, []), {
        bodies: [bodyOf([])],
        oversized: [],
      });
    });
  });

  describe("isValidItem", () => {
    const item = {
      id: "3f8a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
      createdAt: "2026-09-22T10:00:00.000Z",
      kind: "user",
    };

    it("accepts what the client actually stores", async () => {
      const mod = await load();
      assert.equal(mod.isValidItem(item), true);
      assert.equal(
        mod.isValidItem({ ...item, id: crypto.randomUUID() }),
        true,
        "an id straight from crypto.randomUUID"
      );
      assert.equal(
        mod.isValidItem({ ...item, id: item.id.toUpperCase() }),
        true,
        "Postgres reads a uuid case-insensitively, so this must too"
      );
    });

    it("rejects an id that is a string but not a uuid", async () => {
      // Reachable without a malicious client: threads live in IndexedDB, which
      // the user can edit, and `isStoredItem` accepts any string for an id.
      // Unchecked, `v.id::uuid` makes this a 500 rather than the 400 it is.
      const mod = await load();
      assert.equal(mod.isValidItem({ ...item, id: "msg-17" }), false);
      assert.equal(mod.isValidItem({ ...item, id: "" }), false);
      assert.equal(
        mod.isValidItem({ ...item, id: `${item.id}-extra` }),
        false,
        "anchored, so a uuid with a tail is not one"
      );
    });

    it("rejects a createdAt no timestamptz cast would take", async () => {
      const mod = await load();
      assert.equal(mod.isValidItem({ ...item, createdAt: "yesterday" }), false);
      assert.equal(mod.isValidItem({ ...item, createdAt: "" }), false);
      assert.equal(
        mod.isValidItem({ ...item, createdAt: 1758535200000 }),
        false
      );
    });

    it("rejects an updatedAt no timestamptz cast would take", async () => {
      // The upsert casts it to decide which copy is newer, so an unparseable
      // one would be a 500 from the driver rather than a 400 from here
      const mod = await load();
      assert.equal(mod.isValidItem({ ...item, updatedAt: "later" }), false);
      assert.equal(mod.isValidItem({ ...item, updatedAt: "" }), false);
      assert.equal(
        mod.isValidItem({ ...item, updatedAt: 1758535200000 }),
        false
      );
      assert.equal(mod.isValidItem({ ...item, updatedAt: null }), false);
    });

    it("accepts an item with or without a valid updatedAt", async () => {
      const mod = await load();
      assert.equal(
        mod.isValidItem({ ...item, updatedAt: "2026-09-22T10:00:05.000Z" }),
        true
      );
      assert.equal(mod.isValidItem(item), true, "old data has none");
    });

    it("still rejects an unknown kind and a missing item", async () => {
      const mod = await load();
      assert.equal(mod.isValidItem({ ...item, kind: "system" }), false);
      assert.equal(mod.isValidItem(null), false);
    });
  });
});
