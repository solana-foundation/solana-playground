import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { connector } from "./providers/cloud-sql.mjs";

const load = async () => {
  // Fresh module per case: the pool is memoised at module scope
  const url = new URL("./db.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
};

/** A `cloud-sql` deployment with every variable set, for a case to adjust */
const CLOUD_SQL = {
  DB_PROVIDER: "cloud-sql",
  CLOUD_SQL_INSTANCE: "project:region:solpg-preview",
  CLOUD_SQL_DATABASE: "solpg_preview_pr_42",
  CLOUD_SQL_USER: "vercel-preview@project.iam",
  GCP_PROJECT_NUMBER: "123",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
  GCP_SERVICE_ACCOUNT_EMAIL: "vercel-preview@project.iam.gserviceaccount.com",
  VERCEL_ENV: "preview",
};

/** Sets the `cloud-sql` variables, then each override; `undefined` unsets */
const asCloudSql = (overrides = {}) => {
  Object.assign(process.env, CLOUD_SQL);
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
};

/** Stands in for the connector, so no case reaches Google */
const stubConnector = () =>
  mock.method(connector, "options", async () => ({ stream: () => null }));

describe("db", () => {
  // Cleared before each case, not after: `yarn test-api` loads `.env`, so the
  // environment these cases assert is absent would otherwise be present.
  beforeEach(() => {
    const names = ["DATABASE_URL", "SYNC_ENABLED"].concat(
      Object.keys(CLOUD_SQL)
    );
    for (const name of names) {
      delete process.env[name];
    }
  });
  afterEach(() => mock.restoreAll());

  it("reports unconfigured when DATABASE_URL is absent", async () => {
    const db = await load();
    assert.equal(db.isConfigured(), false);
    assert.equal(await db.getPool(), null);
  });

  it("defaults to the url provider", async () => {
    process.env.DATABASE_URL = "postgres://x/y";
    const db = await load();
    assert.equal(db.isConfigured(), true);
    assert.equal(
      (await db.getPool()).options.connectionString,
      "postgres://x/y"
    );
  });

  it("refuses an unknown provider rather than falling back", async () => {
    // A misspelling beside a stray DATABASE_URL must not quietly connect
    // through it: the deployment reads as configured-but-broken, and every
    // attempt names the value
    process.env.DB_PROVIDER = "cloudsql";
    process.env.DATABASE_URL = "postgres://x/y";
    const db = await load();
    assert.equal(db.isConfigured(), true);
    await assert.rejects(() => db.getPool(), /"cloudsql"/);
    await assert.rejects(() => db.query("select 1"), /"cloudsql"/);
  });

  it("retries a pool that failed to build", async () => {
    // A transient token exchange or certificate failure on a warm instance
    // must not be cached for the life of that instance
    asCloudSql();
    let calls = 0;
    mock.method(connector, "options", async () => {
      calls += 1;
      if (calls === 1) throw new Error("certificate fetch failed");
      return { stream: () => null };
    });
    const db = await load();
    await assert.rejects(() => db.getPool(), /certificate fetch failed/);
    const pool = await db.getPool();
    assert.equal(pool.options.database, "solpg_preview_pr_42");
    assert.equal(calls, 2);
    // Built once it succeeds: the next call reuses it
    assert.equal(await db.getPool(), pool);
    assert.equal(calls, 2);
  });

  it("reports unconfigured when a Cloud SQL variable is missing", async () => {
    asCloudSql({ CLOUD_SQL_USER: undefined });
    const options = stubConnector();
    const db = await load();
    assert.equal(db.isConfigured(), false);
    assert.equal(await db.getPool(), null);
    assert.equal(options.mock.callCount(), 0);
  });

  it("refuses the production database outside production", async () => {
    // Unset as well as `preview`: a laptop or CI run is not production either
    for (const VERCEL_ENV of ["preview", "development", undefined]) {
      asCloudSql({ CLOUD_SQL_DATABASE: "solpg", VERCEL_ENV });
      const options = stubConnector();
      mock.method(console, "error", () => {});
      const db = await load();
      assert.equal(db.isConfigured(), true);
      await assert.rejects(() => db.getPool(), /refusing database "solpg"/);
      // Before the token exchange: nothing reached Google
      assert.equal(options.mock.callCount(), 0);
      mock.restoreAll();
    }
  });

  it("allows a preview database outside production", async () => {
    asCloudSql();
    const options = stubConnector();
    const db = await load();
    const pool = await db.getPool();
    assert.equal(options.mock.callCount(), 1);
    assert.equal(pool.options.database, "solpg_preview_pr_42");
    assert.equal(pool.options.user, "vercel-preview@project.iam");
    // No password and no URL: the connector's stream and IAM carry the login
    assert.equal(pool.options.password, undefined);
    assert.equal(pool.options.connectionString, undefined);
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
    assert.deepEqual((await db.getPool()).options.ssl, {
      rejectUnauthorized: true,
    });
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
    (await db.getPool()).connect = async () => client;
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
