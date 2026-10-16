import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import handler from "./sync.mjs";

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

describe("GET /api/sync", () => {
  // Cleared before each case, not after: `yarn test-api` loads `.env`, so the
  // environment these cases assert is absent would otherwise be present.
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.SYNC_ENABLED;
  });

  it("reports unconfigured without touching the database", async () => {
    const res = makeRes();
    await handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {
      enabled: false,
      db: "unconfigured",
    });
  });

  it("rejects anything but GET", async () => {
    const res = makeRes();
    await handler({ method: "POST" }, res);
    assert.equal(res.statusCode, 405);
  });
});
