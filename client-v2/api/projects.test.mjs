import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

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
  });

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
});
