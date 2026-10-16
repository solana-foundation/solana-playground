// Its own file, so its own process under `node --test`: auth.test.mjs opens the
// persistence pool against a database that does not exist, and the pool
// outlives the fresh `auth.mjs` each case here loads
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

/** Sets each named variable, or deletes it for `undefined`, and returns a restore */
const withEnv = (vars) => {
  const saved = Object.keys(vars).map((name) => [name, process.env[name]]);
  const assign = (entries) => {
    for (const [name, value] of entries) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  assign(Object.entries(vars));
  return () => assign(saved);
};

const load = async () => {
  // Fresh module per case: the auth instance is memoised at module scope
  const url = new URL("./auth.mjs", import.meta.url);
  url.searchParams.set("t", String(Math.random()));
  return import(url.href);
};

// The cases that run a request need a real database
const needsDatabase = process.env.DATABASE_URL ? false : "needs DATABASE_URL";

const HOST = "https://solana-playground-teal.vercel.app";
const PREVIEW_HOST = "solana-playground-abc123-hoodies.vercel.app";
const PREVIEW = `https://${PREVIEW_HOST}`;
const PROXY_SECRET = "proxy-secret-proxy-secret-proxy-secret";

/** The environment a preview deploys with: the host's URL, no base URL */
const asPreview = () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_URL = PREVIEW_HOST;
  process.env.AUTH_OAUTH_PROXY_URL = HOST;
  process.env.AUTH_OAUTH_PROXY_SECRET = PROXY_SECRET;
};

/** The environment the host deploys with: its own base URL, no proxy URL */
const asHost = () => {
  process.env.VERCEL_ENV = "production";
  process.env.AUTH_BASE_URL = HOST;
  process.env.AUTH_OAUTH_PROXY_SECRET = PROXY_SECRET;
};

/** The proxy's completion endpoint, with a profile that does not decrypt */
const complete = (auth, origin) =>
  auth.handler(
    new Request(
      `${origin}/api/auth/callback/github/oauth-proxy?callbackURL=%2F&profile=x`
    )
  );

/** What `signIn.social` sends from the popup */
const signIn = (auth, origin) =>
  auth.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/api/auth-complete?nonce=n",
        disableRedirect: true,
      }),
    })
  );

describe("oauthProxyPlugins", () => {
  // Cleared for each case: `yarn test-api` loads `.env`
  let restore;
  beforeEach(() => {
    restore = withEnv({
      AUTH_BASE_URL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_URL: undefined,
      AUTH_OAUTH_PROXY_URL: undefined,
      AUTH_OAUTH_PROXY_SECRET: undefined,
      AUTH_SECRET: "a-test-secret-of-at-least-32-bytes!",
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    });
  });
  afterEach(() => restore());

  test("is off without the secret", async () => {
    process.env.VERCEL_URL = PREVIEW_HOST;
    process.env.AUTH_OAUTH_PROXY_URL = HOST;
    const { oauthProxyPlugins } = await load();
    assert.deepEqual(oauthProxyPlugins(), []);
  });

  test("serves the completion endpoint on a preview", async () => {
    asPreview();
    const { oauthProxyPlugins } = await load();
    const [plugin] = oauthProxyPlugins();
    assert.ok(plugin.endpoints.oAuthProxyCompletion);
  });

  // The secret sits in every preview's environment; on the host the endpoint
  // would turn a payload anyone holding it can forge into a session there
  test("drops the completion endpoints on the host", async () => {
    asHost();
    const { oauthProxyPlugins } = await load();
    const [plugin] = oauthProxyPlugins();
    assert.deepEqual(plugin.endpoints, {});
    assert.ok(plugin.hooks.before.length > 0);
  });

  test("is the host when the proxy URL names this deployment", async () => {
    asHost();
    process.env.AUTH_OAUTH_PROXY_URL = `${HOST}/`;
    const { oauthProxyPlugins } = await load();
    const [plugin] = oauthProxyPlugins();
    assert.deepEqual(plugin.endpoints, {});
  });

  // Fails closed: production given the preview's settings by mistake
  test("is the host outside a preview whatever the proxy URL", async () => {
    asPreview();
    process.env.VERCEL_ENV = "production";
    const { oauthProxyPlugins } = await load();
    const [plugin] = oauthProxyPlugins();
    assert.deepEqual(plugin.endpoints, {});
  });

  test("reports a proxy URL without its secret", async () => {
    asPreview();
    delete process.env.AUTH_OAUTH_PROXY_SECRET;
    const { missingConfig } = await load();
    assert.ok(missingConfig().includes("AUTH_OAUTH_PROXY_SECRET"));
  });

  test("reports a proxy URL that is not a URL", async () => {
    asPreview();
    process.env.AUTH_OAUTH_PROXY_URL = "solana-playground-teal.vercel.app";
    const { missingConfig } = await load();
    assert.ok(missingConfig().includes("AUTH_OAUTH_PROXY_URL"));
  });

  test(
    "sends a preview's GitHub callback to the host",
    { skip: needsDatabase },
    async () => {
      asPreview();
      const { getAuth } = await load();
      const res = await signIn(getAuth(), PREVIEW);
      assert.equal(res.status, 200);

      const github = new URL((await res.json()).url);
      assert.equal(
        github.searchParams.get("redirect_uri"),
        `${HOST}/api/auth/callback/github`
      );
    }
  );

  // The control for the case below: the same request reaches the endpoint
  test(
    "routes the completion endpoint on a preview",
    { skip: needsDatabase },
    async () => {
      asPreview();
      const { getAuth } = await load();
      const res = await complete(getAuth(), PREVIEW);
      assert.notEqual(res.status, 404);
    }
  );

  test(
    "404s the completion endpoint on the host",
    { skip: needsDatabase },
    async () => {
      asHost();
      const { getAuth } = await load();
      const res = await complete(getAuth(), HOST);
      assert.equal(res.status, 404);
    }
  );
});
