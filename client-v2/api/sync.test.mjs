import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

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
    delete process.env.DB_PROVIDER;
    delete process.env.DATABASE_URL;
    delete process.env.SYNC_ENABLED;
  });
  afterEach(() => mock.restoreAll());

  it("reports unreachable without detail", async () => {
    // A preview naming the production database: the provider refuses, and the
    // refusal's text (database, environment) must stay in the function log
    const vars = {
      DB_PROVIDER: "cloud-sql",
      CLOUD_SQL_INSTANCE: "project:region:solpg",
      CLOUD_SQL_DATABASE: "solpg",
      CLOUD_SQL_USER: "vercel-preview@project.iam",
      GCP_PROJECT_NUMBER: "123",
      GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
      GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
      GCP_SERVICE_ACCOUNT_EMAIL:
        "vercel-preview@project.iam.gserviceaccount.com",
      VERCEL_ENV: "preview",
    };
    const saved = Object.keys(vars).map((name) => [name, process.env[name]]);
    Object.assign(process.env, vars);
    mock.method(console, "error", () => {});
    try {
      const res = makeRes();
      await handler({ method: "GET" }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body, '{"enabled":false,"db":"unreachable"}');
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
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
