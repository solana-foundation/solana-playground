import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { DELETED_REASON } from "../src/features/persistence/server.mjs";

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
      // Neither AUTH_BASE_URL nor VERCEL_URL, which is local development
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
        "../src/features/persistence/model/conversations.mjs"
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
        "../src/features/persistence/model/conversations.mjs"
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
        "../src/features/persistence/model/conversations.mjs"
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
