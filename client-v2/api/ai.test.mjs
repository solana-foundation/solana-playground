import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

// `GET /api/ai/status` is the one answer the client gates AI surfaces on
// (spec `assistant-ai-status`). The session is injected through
// `statusHandler`, so every caller state is reachable without a database.
const load = async () => {
  const url = new URL("./ai.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
};

const makeRes = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(k, v) {
    this.headers[k.toLowerCase()] = v;
  },
  end(b) {
    this.body = b ?? "";
  },
});

/** What sign-in needs: the hosted key counts only where it can sign a user in */
const SIGN_IN = {
  DATABASE_URL: "postgres://test@localhost/test",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  AUTH_SECRET: "test-auth-secret",
};

const KEY = "sk-agent-hosted-secret-0123456789";
const NEWCOMER_KEY = "sk-agent-newcomer-secret-9876543210";
const MODEL = "vendor/model-x";

const VARS = [
  "AGENT_API_KEY",
  "AGENT_NEWCOMER_API_KEY",
  "AGENT_MODEL",
  "AUTH_OAUTH_PROXY_URL",
  "AUTH_OAUTH_PROXY_SECRET",
  ...Object.keys(SIGN_IN),
];

const configureHostedKey = () => {
  Object.assign(process.env, SIGN_IN);
  process.env.AGENT_API_KEY = KEY;
  process.env.AGENT_NEWCOMER_API_KEY = NEWCOMER_KEY;
  process.env.AGENT_MODEL = MODEL;
};

describe("GET /api/ai/status", () => {
  /** What `yarn test-api` loaded from `.env`, put back after each case */
  const saved = {};

  beforeEach(() => {
    for (const name of VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  /**
   * Call the route with a session answer of our choosing.
   *
   * @param {{ session?: object; method?: string }} options
   */
  const call = async ({ session, method = "GET" } = {}) => {
    const { statusHandler } = await load();
    let asked = 0;
    const handler = statusHandler({
      readSession: async () => {
        asked += 1;
        if (!session) throw new Error("the session was read unexpectedly");
        return session;
      },
    });
    const res = makeRes();
    await handler({ method, url: "/api/ai/status", headers: {} }, res);
    return { res, asked };
  };

  const body = (res) => {
    assert.equal(res.statusCode, 200);
    return JSON.parse(res.body);
  };

  it("assistant-ai-status: No key configured", async () => {
    const { res, asked } = await call();

    assert.deepEqual(body(res), {
      available: false,
      key: "own",
      reason: null,
      model: null,
    });
    assert.equal(asked, 0);
  });

  it("assistant-ai-status: No key configured, a key without sign-in", async (t) => {
    process.env.AGENT_API_KEY = KEY;
    process.env.AGENT_MODEL = MODEL;
    const warn = t.mock.method(console, "warn", () => {});

    const { res, asked } = await call();

    assert.deepEqual(body(res), {
      available: false,
      key: "own",
      reason: null,
      model: null,
    });
    assert.equal(asked, 0);
    // Names only: the warning lists what is missing, never a value
    assert.equal(warn.mock.callCount(), 1);
    assert.ok(!JSON.stringify(warn.mock.calls[0].arguments).includes(KEY));
  });

  it("assistant-ai-status: No key configured, sign-in without a key", async () => {
    Object.assign(process.env, SIGN_IN);

    const { res, asked } = await call();

    assert.deepEqual(body(res), {
      available: false,
      key: "own",
      reason: null,
      model: null,
    });
    assert.equal(asked, 0);
  });

  it("assistant-ai-status: Signed out with the hosted key", async () => {
    configureHostedKey();

    const { res } = await call({ session: { status: "signed-out" } });

    assert.deepEqual(body(res), {
      available: false,
      key: "hosted",
      reason: "signed-out",
      model: MODEL,
    });
  });

  it("assistant-ai-status: Signed in with the hosted key", async () => {
    configureHostedKey();

    const { res } = await call({
      session: { status: "signed-in", user: { id: "u1" } },
    });

    assert.deepEqual(body(res), {
      available: true,
      key: "hosted",
      reason: null,
      model: MODEL,
    });
  });

  it("assistant-ai-status: The session lookup fails", async () => {
    configureHostedKey();

    const { res } = await call({ session: { status: "unavailable" } });

    assert.deepEqual(body(res), {
      available: false,
      key: "hosted",
      reason: "unavailable",
      model: MODEL,
    });
  });

  it("assistant-ai-status: Sign-in reads as unconfigured at lookup", async (t) => {
    configureHostedKey();
    const warn = t.mock.method(console, "warn", () => {});

    const { res } = await call({ session: { status: "unconfigured" } });

    assert.deepEqual(body(res), {
      available: false,
      key: "own",
      reason: null,
      model: null,
    });
    assert.equal(warn.mock.callCount(), 1);
  });

  it("assistant-ai-status: A configured key stays on the server", async () => {
    configureHostedKey();

    const answers = [
      { session: { status: "signed-in", user: { id: "u1" } } },
      { session: { status: "signed-out" } },
      { session: { status: "unavailable" } },
      { method: "POST" },
    ];
    for (const options of answers) {
      const { res } = await call(options);

      const sent = res.body + JSON.stringify(res.headers);
      for (const key of [KEY, NEWCOMER_KEY]) {
        // Any run of 8 characters from the key is a leak
        for (let i = 0; i + 8 <= key.length; i += 1) {
          assert.ok(
            !sent.includes(key.slice(i, i + 8)),
            `the answer holds part of a key: ${key.slice(i, i + 8)}`
          );
        }
      }
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(res.headers["content-type"], "application/json");
    }
  });

  it("offers the hosted key exactly where GET /api/agent serves it", async () => {
    // The two routes write the rule twice; this holds them together until
    // the client reads only this one
    const setups = {
      "nothing configured": () => {},
      "a key only": () => {
        process.env.AGENT_API_KEY = KEY;
      },
      "sign-in only": () => Object.assign(process.env, SIGN_IN),
      "a key and sign-in": configureHostedKey,
    };
    const agentUrl = new URL("./agent.mjs", import.meta.url);

    for (const [name, setup] of Object.entries(setups)) {
      for (const varName of VARS) delete process.env[varName];
      setup();

      const { res } = await call({
        session: { status: "signed-in", user: { id: "u1" } },
      });
      agentUrl.searchParams.set("t", String(Math.random()));
      const agent = await import(agentUrl.href);
      const agentRes = makeRes();
      await agent.default(
        { method: "GET", url: "/api/agent", headers: {} },
        agentRes
      );
      const served = JSON.parse(agentRes.body);
      const status = body(res);

      assert.equal(status.key === "hosted", served.configured, name);
      assert.equal(status.model, served.model, name);
    }
  });

  it("answers HEAD with the GET's status and headers, and no body", async () => {
    configureHostedKey();

    const { res } = await call({
      method: "HEAD",
      session: { status: "signed-out" },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.body, "");
  });

  it("assistant-ai-status: A POST is refused", async () => {
    configureHostedKey();

    const { res, asked } = await call({ method: "POST" });

    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, HEAD");
    assert.equal(asked, 0);
  });

  it("serves the status through its default export", async () => {
    const mod = await load();
    const res = makeRes();

    await mod.default(
      { method: "GET", url: "/api/ai/status", headers: {} },
      res
    );

    assert.deepEqual(body(res), {
      available: false,
      key: "own",
      reason: null,
      model: null,
    });
  });
});
