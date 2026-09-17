import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

const load = async () => {
  const url = new URL("./auth.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
};

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

describe("/api/auth", () => {
  // Cleared before each case, not after: `yarn test-api` loads `.env`, so the
  // credentials these cases assert are missing would otherwise be present.
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  it("503s when the database is not configured, instead of crashing on import", async () => {
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/auth/session", headers: {} },
      res
    );
    assert.equal(res.statusCode, 503);
    assert.match(JSON.parse(res.body).error, /not configured/i);
  });

  it("503s when the database is set but GitHub credentials are missing", async () => {
    process.env.DATABASE_URL = "postgres://x/y";
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/auth/session", headers: {} },
      res
    );
    assert.equal(res.statusCode, 503);
  });
});
