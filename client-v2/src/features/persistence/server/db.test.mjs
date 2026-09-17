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

  it("rejects a query when unconfigured, rather than throwing on import", async () => {
    const db = await load();
    await assert.rejects(() => db.query("select 1"), /not configured/i);
  });
});
