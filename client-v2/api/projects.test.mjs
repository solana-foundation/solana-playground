import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { NO_FILES_REASON } from "../src/features/persistence/server.mjs";

// Read before `beforeEach` clears it: the cases below assert on an unconfigured
// environment, and the one that needs a real database opens its own connection.
const DB = process.env.DATABASE_URL;

const load = async () => {
  // Fresh module per case: `db.mjs` memoises its pool at module scope
  const url = new URL("./projects.mjs", import.meta.url);
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

describe("/api/projects", () => {
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
    await mod.default({ method: "GET", url: "/", headers: {} }, res);
    assert.equal(res.statusCode, 503);
  });

  it("401s when enabled but signed out", async () => {
    process.env.DATABASE_URL = "postgres://x/y";
    process.env.SYNC_ENABLED = "true";
    const mod = await load();
    const res = makeRes();
    await mod.default({ method: "GET", url: "/", headers: {} }, res);
    assert.equal(res.statusCode, 401);
  });

  it("puts the auth gate ahead of the method check", async () => {
    process.env.DATABASE_URL = "postgres://x/y";
    process.env.SYNC_ENABLED = "true";
    const mod = await load();
    const res = makeRes();
    await mod.default({ method: "PATCH", url: "/", headers: {} }, res);
    assert.equal(res.statusCode, 401);
  });

  describe("origin", () => {
    it("refuses a write from another origin", async () => {
      enableSync();
      process.env.AUTH_BASE_URL = "https://solpg.example";
      const mod = await load();
      const res = makeRes();
      await mod.default(
        makeReq({ method: "PUT", headers: { origin: "https://evil.example" } }),
        res
      );
      assert.equal(res.statusCode, 403);
    });

    it("refuses a DELETE from another origin too", async () => {
      enableSync();
      process.env.AUTH_BASE_URL = "https://solpg.example";
      const mod = await load();
      const res = makeRes();
      await mod.default(
        makeReq({
          method: "DELETE",
          url: "/?id=p1",
          headers: { origin: "https://evil.example" },
        }),
        res
      );
      assert.equal(res.statusCode, 403);
    });

    it("lets our own origin through, path on the base URL or not", async () => {
      // Better Auth's base URL may carry `/api/auth`; an `Origin` never does,
      // so both sides are compared as origins rather than as strings.
      enableSync();
      process.env.AUTH_BASE_URL = "https://solpg.example/api/auth";
      const mod = await load();
      const res = makeRes();
      await mod.default(
        makeReq({
          method: "PUT",
          headers: { origin: "https://solpg.example" },
        }),
        res
      );
      // 401 rather than 200: it got past the origin gate and stopped at auth,
      // which is as far as a direct call can go
      assert.equal(res.statusCode, 401);
    });

    it("checks nothing when there is no deployment origin to check", async () => {
      // No AUTH_BASE_URL and no Vercel hostname, which is local development
      enableSync();
      const mod = await load();
      const res = makeRes();
      await mod.default(
        makeReq({
          method: "PUT",
          headers: { origin: "http://localhost:3000" },
        }),
        res
      );
      assert.equal(res.statusCode, 401);
    });

    it("leaves reads alone", async () => {
      enableSync();
      process.env.AUTH_BASE_URL = "https://solpg.example";
      const mod = await load();
      const res = makeRes();
      await mod.default(
        makeReq({ headers: { origin: "https://evil.example" } }),
        res
      );
      assert.equal(res.statusCode, 401);
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
      // The two used to share a `try`, so a 400's worth of malformed JSON came
      // back as 413 -- telling a client to shrink a body that was never big
      const mod = await load();
      assert.deepEqual(await mod.readBody(streamOf(Buffer.from("{oops"))), {
        error: "malformed",
      });
    });

    it("reads an empty body as an empty object", async () => {
      const mod = await load();
      assert.deepEqual(await mod.readBody(streamOf()), { body: {} });
    });

    it("stops at the cap rather than buffering the whole body", async () => {
      const mod = await load();
      // One buffer yielded nine times: the point is the running total, and
      // allocating 9 MB to prove it would be the test's own bug
      const mb = Buffer.alloc(1_000_000);
      const chunks = Array.from({ length: 9 }, () => mb);
      assert.deepEqual(await mod.readBody(streamOf(...chunks)), {
        error: "too-large",
      });
    });

    it("refuses a body the platform would refuse first", async () => {
      // Vercel answers a body over 4.5 MB with its own 413 before the handler
      // runs. Under that, a refusal is ours and says what to do about it.
      const mod = await load();
      const mb = Buffer.alloc(1_000_000);
      const chunks = Array.from({ length: 5 }, () => mb);
      assert.deepEqual(await mod.readBody(streamOf(...chunks)), {
        error: "too-large",
      });
    });
  });

  describe("describeProject", () => {
    const UUID = "4f1c9a52-5d0e-4c55-9a3b-2d6f0b8e7c11";

    it("takes a project and a tutorial whose kinds match their ids", async () => {
      const mod = await load();
      assert.deepEqual(
        mod.describeProject({ id: UUID, name: "mine", kind: "project" }),
        { id: UUID, name: "mine", kind: "project" }
      );
      assert.deepEqual(
        mod.describeProject({
          id: "tut:hello-anchor",
          name: "Hello Anchor",
          kind: "tutorial",
        }),
        { id: "tut:hello-anchor", name: "Hello Anchor", kind: "tutorial" }
      );
    });

    it("refuses an empty name, blank included", async () => {
      const mod = await load();
      assert.deepEqual(
        mod.describeProject({ id: UUID, name: "", kind: "project" }),
        { error: "name must not be empty" }
      );
      assert.deepEqual(
        mod.describeProject({ id: UUID, name: "  ", kind: "project" }),
        { error: "name must not be empty" }
      );
    });

    it("refuses a kind its id contradicts", async () => {
      const mod = await load();
      assert.deepEqual(
        mod.describeProject({ id: "tut:hello", name: "x", kind: "project" }),
        { error: "kind must be tutorial for this id" }
      );
      assert.deepEqual(
        mod.describeProject({ id: UUID, name: "x", kind: "tutorial" }),
        { error: "kind must be project for this id" }
      );
    });

    it("refuses a missing id, name or kind, and a kind it does not know", async () => {
      const mod = await load();
      assert.ok(mod.describeProject({ name: "x", kind: "project" }).error);
      assert.ok(mod.describeProject({ id: UUID, kind: "project" }).error);
      assert.ok(mod.describeProject({ id: UUID, name: "x" }).error);
      assert.deepEqual(
        mod.describeProject({ id: UUID, name: "x", kind: "program" }),
        { error: "kind must be one of project, tutorial" }
      );
    });
  });

  describe("describeDriverError", () => {
    it("maps a name collision to a 409 the client can tell apart", async () => {
      const mod = await load();
      const { status, body } = mod.describeDriverError({ code: "23505" });

      assert.equal(status, 409);
      assert.equal(body.reason, "name-taken");
      // Deliberately absent. The client branches on `conflict === true` to
      // decide whether a project diverged; setting it here would raise a
      // "keep this version or take the other" banner about a name, which is
      // not a question either answer fits.
      assert.equal(body.conflict, undefined);
    });

    it("keeps the driver's own text out of any other answer", async () => {
      const mod = await load();
      const { status, body } = mod.describeDriverError(
        Object.assign(new Error('column "secret" does not exist'), {
          code: "42703",
        })
      );

      assert.equal(status, 500);
      assert.ok(!JSON.stringify(body).includes("secret"));
    });

    it(
      "maps the code Postgres actually sends",
      { skip: !DB && "DATABASE_URL not set" },
      async () => {
        // The unit cases above assert on a literal `23505`. This one earns it:
        // two live projects under one name in one account is the collision the
        // route exists to answer, and `pushCurrent` sends whatever the local
        // workspace is called, so `reconcile` reaches it on its own.
        //
        // Its own connection rather than `server/db.mjs`: that module memoises
        // its pool, and the signed-out cases above have already built one --
        // Better Auth asks for it on the way to reading a session -- against
        // the placeholder URL they set. Reusing it here would test that string.
        const pg = (await import("pg")).default;
        const pool = new pg.Pool({ connectionString: DB, max: 1 });
        pool.on("error", () => {});
        const userId = "test-user-api-projects";
        const row = (id, name) =>
          pool.query(
            `insert into projects (id, user_id, name, kind, updated_at)
             values ($1, $2, $3, 'project', now())`,
            [id, userId, name]
          );

        try {
          await pool.query(
            `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
             values ($1, 'Test', 'api-projects@example.com', false, now(), now())
             on conflict (id) do nothing`,
            [userId]
          );
          await pool.query("delete from projects where user_id = $1", [userId]);

          await row("p1", "taken");
          const e = await row("p2", "taken").then(
            () => null,
            (err) => err
          );

          assert.ok(e, "a second live project under one name is refused");
          assert.equal(e.code, "23505");
          assert.equal(e.constraint, "projects_user_name_idx");

          const mod = await load();
          const { status, body } = mod.describeDriverError(e);
          assert.equal(status, 409);
          assert.equal(body.reason, "name-taken");
          assert.equal(body.conflict, undefined);
        } finally {
          await pool
            .query("delete from projects where user_id = $1", [userId])
            .catch(() => {});
          await pool.end();
        }
      }
    );
  });

  describe("describeWrite", () => {
    const token = { baseUpdatedAt: "2026-01-01T00:00:00.000Z" };

    it("takes a whole file set", async () => {
      const mod = await load();
      assert.deepEqual(mod.describeWrite({ files: { a: "1" } }), {
        files: { a: "1" },
      });
    });

    it("refuses an empty file set, which would erase the project", async () => {
      const mod = await load();
      assert.ok(mod.describeWrite({ files: {} }).error);
    });

    it("takes a patch that carries a token", async () => {
      const mod = await load();
      assert.deepEqual(
        mod.describeWrite({ changed: { a: "2" }, removed: ["b"], ...token }),
        { changed: { a: "2" }, removed: ["b"] }
      );
    });

    it("refuses a patch without a token: there is nothing it is relative to", async () => {
      const mod = await load();
      assert.ok(mod.describeWrite({ changed: { a: "2" }, removed: [] }).error);
    });

    it("refuses force: true with a 409, which the pre-#40 client surfaces", async () => {
      // That client files every other failing status under a silent "skipped"
      const mod = await load();
      const patch = mod.describeWrite({
        changed: {},
        removed: [],
        force: true,
        baseUpdatedAt: token.baseUpdatedAt,
      });
      assert.ok(patch.error);
      assert.equal(patch.status, 409);
      const full = mod.describeWrite({ files: { a: "1" }, force: true });
      assert.ok(full.error);
      assert.equal(full.status, 409);
    });

    it("answers every other refusal with a 400", async () => {
      const mod = await load();
      assert.equal(mod.describeWrite({}).status, 400);
      assert.equal(mod.describeWrite({ files: {} }).status, 400);
      // Only the boolean `true` is the old client's "keep this version"
      for (const force of [null, 0, "true", "false"]) {
        const refused = mod.describeWrite({ files: { a: "1" }, force });
        assert.ok(refused.error);
        assert.equal(refused.status, 400);
      }
    });

    it("reads force: false as absent", async () => {
      const mod = await load();
      assert.deepEqual(mod.describeWrite({ files: { a: "1" }, force: false }), {
        files: { a: "1" },
      });
    });

    it("takes the pre-#40 client's body as a whole file set", async () => {
      // Exactly what that client sends on every ordinary push, so a tab left
      // open across the deploy keeps syncing until it is reloaded
      const mod = await load();
      const body = JSON.parse(
        JSON.stringify({
          id: "p1",
          name: "one",
          kind: "project",
          snapshot: { files: { "src/lib.rs": "fn main() {}" } },
          baseUpdatedAt: token.baseUpdatedAt,
          force: false,
        })
      );
      assert.deepEqual(mod.describeWrite(body), {
        files: { "src/lib.rs": "fn main() {}" },
      });
    });

    it("refuses an old-format body that is empty or not a file map", async () => {
      const mod = await load();
      assert.ok(mod.describeWrite({ snapshot: { files: {} } }).error);
      assert.ok(mod.describeWrite({ snapshot: null }).error);
      assert.ok(mod.describeWrite({ snapshot: { files: { a: 1 } } }).error);
    });

    it("refuses an old-format body that also carries a new shape", async () => {
      const mod = await load();
      assert.ok(
        mod.describeWrite({
          snapshot: { files: { a: "1" } },
          files: { a: "1" },
        }).error
      );
      assert.ok(
        mod.describeWrite({
          snapshot: { files: { a: "1" } },
          changed: {},
          baseUpdatedAt: token.baseUpdatedAt,
        }).error
      );
    });

    it("refuses both shapes at once, and neither", async () => {
      const mod = await load();
      assert.ok(
        mod.describeWrite({ files: { a: "1" }, changed: {}, ...token }).error
      );
      assert.ok(mod.describeWrite({}).error);
    });

    it("refuses a path that is both changed and removed", async () => {
      const mod = await load();
      assert.ok(
        mod.describeWrite({ changed: { a: "1" }, removed: ["a"], ...token })
          .error
      );
    });

    it("refuses an old-format body that also carries a removal list", async () => {
      const mod = await load();
      assert.ok(
        mod.describeWrite({
          snapshot: { files: { a: "1" } },
          removed: ["b"],
          baseUpdatedAt: token.baseUpdatedAt,
        }).error
      );
    });

    it("refuses content that is not a string, and an empty path", async () => {
      const mod = await load();
      assert.ok(mod.describeWrite({ files: { a: 1 } }).error);
      assert.ok(mod.describeWrite({ files: { "": "x" } }).error);
      assert.ok(
        mod.describeWrite({ changed: {}, removed: [7], ...token }).error
      );
    });
  });

  describe("describeSaved", () => {
    it("answers an accepted write with a 200 and its token", async () => {
      const mod = await load();
      assert.deepEqual(mod.describeSaved({ updatedAt: "t2" }), {
        status: 200,
        body: { updatedAt: "t2" },
      });
    });

    it("answers a conflict with a 409, the body as the store said it", async () => {
      const mod = await load();
      const conflict = { conflict: true, updatedAt: "t1", reason: "deleted" };
      assert.deepEqual(mod.describeSaved(conflict), {
        status: 409,
        body: conflict,
      });
    });

    it("answers a write that would leave no files with a 400 the client can name", async () => {
      // Not a 409: the pre-#40 client would raise "keep this version" over
      // it, and the current one would merge against a row with nothing in it
      const mod = await load();
      const { status, body } = mod.describeSaved({ refused: NO_FILES_REASON });
      assert.equal(status, 400);
      assert.equal(body.reason, NO_FILES_REASON);
      assert.ok(body.error);
    });
  });
});
