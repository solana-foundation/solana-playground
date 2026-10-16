import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

const load = async () => {
  // Fresh module per case: the pool is memoised at module scope
  const url = new URL("./db.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
};

describe("db", () => {
  // Cleared before each case, not after: `yarn test-api` loads `.env`, so the
  // environment these cases assert is absent would otherwise be present.
  beforeEach(() => {
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

  it("requires a verified TLS connection unless the URL says otherwise", async () => {
    // node-postgres connects in the clear when the URL says nothing about SSL,
    // where dbmate refuses. Matching dbmate means a production URL that forgets
    // `sslmode` fails loudly instead of silently sending credentials in
    // plaintext. An explicit `sslmode` in the URL still wins -- that is how the
    // local container opts out.
    process.env.DATABASE_URL = "postgres://x/y";
    const db = await load();
    assert.deepEqual(db.getPool().options.ssl, { rejectUnauthorized: true });
  });

  /**
   * A pool whose one client is scripted, so a transaction's handling of it can
   * be watched without a database. Nothing here connects: `pg.Pool` is lazy.
   */
  const scriptedPool = async (failRollback) => {
    process.env.DATABASE_URL = "postgres://x/y";
    const db = await load();
    const released = [];
    const client = {
      query: async (text) => {
        if (text === "rollback" && failRollback) {
          throw new Error("connection terminated");
        }
        return { rows: [] };
      },
      release: (err) => released.push(err),
    };
    db.getPool().connect = async () => client;
    return { db, released };
  };

  it("destroys a client whose rollback failed, rather than pooling it", async () => {
    // A rollback that fails leaves the connection in a state nobody knows --
    // mid-transaction, or dead. Handed back to the pool, the next request
    // that draws it inherits that. `release(err)` is how `pg` is told to
    // throw it away instead.
    const { db, released } = await scriptedPool(true);

    await assert.rejects(
      () =>
        db.transaction(async () => {
          throw new Error("the write failed");
        }),
      /the write failed/
    );

    assert.equal(released.length, 1);
    assert.match(String(released[0]?.message), /connection terminated/);
  });

  it("returns a client to the pool after a clean rollback", async () => {
    const { db, released } = await scriptedPool(false);

    await assert.rejects(() =>
      db.transaction(async () => {
        throw new Error("the write failed");
      })
    );

    assert.deepEqual(released, [undefined]);
  });

  it("rejects a query when unconfigured, rather than throwing on import", async () => {
    const db = await load();
    await assert.rejects(() => db.query("select 1"), /not configured/i);
  });
});
