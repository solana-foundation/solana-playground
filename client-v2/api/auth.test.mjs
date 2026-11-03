import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { AUTH_NOT_CONFIGURED } from "../src/features/auth/server.mjs";

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

/**
 * A preview on Cloud SQL pointed at the production instance, which the pool
 * refuses before reaching Google
 */
const CLOUD_SQL = {
  DB_PROVIDER: "cloud-sql",
  CLOUD_SQL_INSTANCE: "project:region:solpg",
  CLOUD_SQL_DATABASE: "solpg",
  CLOUD_SQL_USER: "vercel-preview@project.iam",
  GCP_PROJECT_NUMBER: "123",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
  GCP_SERVICE_ACCOUNT_EMAIL: "vercel-preview@project.iam.gserviceaccount.com",
  VERCEL_ENV: "preview",
};

/** Sign-in's own variables */
const setGithub = () => {
  process.env.GITHUB_CLIENT_ID = "id";
  process.env.GITHUB_CLIENT_SECRET = "secret";
  process.env.AUTH_SECRET = "a-test-secret-of-at-least-32-bytes!";
};

describe("/api/auth", () => {
  // Cleared before each case, not after: `yarn test-api` loads `.env`, so the
  // credentials these cases assert are missing would otherwise be present.
  beforeEach(() => {
    const names = [
      "DATABASE_URL",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "AUTH_SECRET",
    ].concat(Object.keys(CLOUD_SQL));
    for (const name of names) {
      delete process.env[name];
    }
  });
  afterEach(() => mock.restoreAll());

  it("503s when the database is not configured, instead of crashing on import", async () => {
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/auth/session", headers: {} },
      res
    );
    assert.equal(res.statusCode, 503);
    // The browser reads this answer as "nobody can be signed in here" only by
    // this exact string in a JSON body (`notConfigured` in the session model)
    assert.equal(JSON.parse(res.body).error, AUTH_NOT_CONFIGURED);
    assert.match(res.headers["content-type"], /application\/json/);
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

  // The whole point of the 503 body: a deployment's environment is invisible
  // from outside, so the answer has to say which half is absent.
  it("names every missing variable", async () => {
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/auth/session", headers: {} },
      res
    );
    assert.deepEqual(JSON.parse(res.body).missing, [
      "DATABASE_URL",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "AUTH_SECRET",
    ]);
  });

  it("names only what is actually absent", async () => {
    process.env.DATABASE_URL = "postgres://x/y";
    process.env.GITHUB_CLIENT_ID = "id";
    process.env.GITHUB_CLIENT_SECRET = "secret";
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/auth/session", headers: {} },
      res
    );
    // It signs the session cookie, so it is as required as the rest
    assert.deepEqual(JSON.parse(res.body).missing, ["AUTH_SECRET"]);
  });

  // A pool that cannot be built is a 503 with a body, not a bare 500
  it("503s without detail when the pool cannot be built", async () => {
    Object.assign(process.env, CLOUD_SQL);
    setGithub();
    const logged = mock.method(console, "error", () => {});
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/auth/session", headers: {} },
      res
    );
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(res.body), {
      error: "Authentication is temporarily unavailable",
    });
    assert.doesNotMatch(res.body, /solpg/);
    // The cause goes to the function log
    assert.ok(
      logged.mock.calls.some((call) =>
        String(call.arguments[1]?.message).includes("refusing instance")
      )
    );
  });

  it("names DB_PROVIDER when it names no provider", async () => {
    process.env.DB_PROVIDER = "cloudsql";
    process.env.DATABASE_URL = "postgres://x/y";
    setGithub();
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/auth/session", headers: {} },
      res
    );
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(res.body).missing, ["DB_PROVIDER"]);
  });

  // Names, never values -- the body is public and the secret is a secret
  it("never puts a value in the body", async () => {
    process.env.DATABASE_URL = "postgres://user:hunter2@host/db";
    process.env.GITHUB_CLIENT_ID = "client-id-value";
    const mod = await load();
    const res = makeRes();
    await mod.default(
      { method: "GET", url: "/auth/session", headers: {} },
      res
    );
    assert.doesNotMatch(res.body, /hunter2|client-id-value/);
  });
});

describe("restorePath", () => {
  /** What the rewrite hands the function: the sub-path in `authPath` */
  it("puts the sub-path back, so Better Auth sees the route it serves", async () => {
    const { restorePath } = await load();
    const req = { url: "/api/auth?authPath=sign-in/social" };
    restorePath(req);
    assert.equal(req.url, "/api/auth/sign-in/social");
  });

  it("keeps the rest of the query, which carries the OAuth callback", async () => {
    const { restorePath } = await load();
    const req = {
      url: "/api/auth?authPath=callback/github&code=abc&state=xyz",
    };
    restorePath(req);
    assert.equal(req.url, "/api/auth/callback/github?code=abc&state=xyz");
  });

  // The dev server dispatches on the first segment and adds no hint
  it("leaves a path that arrived whole alone", async () => {
    const { restorePath } = await load();
    const req = { url: "/auth/sign-in/social" };
    restorePath(req);
    assert.equal(req.url, "/auth/sign-in/social");
  });

  // Whether the platform forwards the original path or the destination one
  it("is idempotent when the original path survived the rewrite", async () => {
    const { restorePath } = await load();
    const req = { url: "/api/auth/sign-in/social?authPath=sign-in/social" };
    restorePath(req);
    assert.equal(req.url, "/api/auth/sign-in/social");
  });
});
