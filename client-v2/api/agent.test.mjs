import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

// The browser's probe (`probeDefaultBackend`) reads this answer: a boolean
// `configured`, and the model by id or `null`. The key never leaves.
const load = async () => {
  const url = new URL("./agent.mjs", import.meta.url);
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

/** What sign-in needs: the default backend is served only where it can sign a user in */
const SIGN_IN = {
  DATABASE_URL: "postgres://test@localhost/test",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  AUTH_SECRET: "test-auth-secret",
};

const AGENT_VARS = [
  "AGENT_API_KEY",
  "AGENT_MODEL",
  "AUTH_OAUTH_PROXY_URL",
  ...Object.keys(SIGN_IN),
];

const configureSignIn = () => Object.assign(process.env, SIGN_IN);

describe("GET /api/agent", () => {
  /** What `yarn test-api` loaded from `.env`, put back after each case */
  const saved = {};

  beforeEach(() => {
    for (const name of AGENT_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of AGENT_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  const get = async () => {
    const mod = await load();
    const res = makeRes();
    await mod.default({ method: "GET", url: "/api/agent", headers: {} }, res);
    assert.equal(res.statusCode, 200);
    return JSON.parse(res.body);
  };

  it("answers configured: false and no model without a key", async () => {
    assert.deepEqual(await get(), { configured: false, model: null });
  });

  it("answers configured: false with a key but no sign-in", async () => {
    process.env.AGENT_API_KEY = "sk-agent-test-key";

    assert.deepEqual(await get(), { configured: false, model: null });
  });

  it("answers configured: true and the model id with a key, never the key", async () => {
    configureSignIn();
    process.env.AGENT_API_KEY = "sk-agent-test-key";
    process.env.AGENT_MODEL = "vendor/model-x";

    const body = await get();

    assert.deepEqual(body, { configured: true, model: "vendor/model-x" });
    assert.doesNotMatch(JSON.stringify(body), /sk-agent-test-key/);
  });

  it("names the default model when none is set", async () => {
    configureSignIn();
    process.env.AGENT_API_KEY = "sk-agent-test-key";

    const body = await get();

    assert.equal(body.configured, true);
    assert.equal(typeof body.model, "string");
  });
});
