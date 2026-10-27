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
const PREVIEW_HOST = "solana-playground-abc123-my-team.vercel.app";
const PREVIEW = `https://${PREVIEW_HOST}`;
const BRANCH_HOST = "solana-playground-git-new-face-my-team.vercel.app";
const BRANCH = `https://${BRANCH_HOST}`;
const OTHER = "https://solana-playground-evil-my-team.vercel.app";
const PROXY_SECRET = "proxy-secret-proxy-secret-proxy-secret";

/**
 * The environment a preview deploys with: the host's URL, no base URL, and
 * Vercel's two hostnames for it
 */
const asPreview = () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_URL = PREVIEW_HOST;
  process.env.VERCEL_BRANCH_URL = BRANCH_HOST;
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

/**
 * What `signIn.social` sends from the popup, on `origin`'s host and from the
 * page at `from`. With a cookie, as a browser on a protected preview always
 * has `_vercel_jwt`: Better Auth checks the `Origin` only on a request that
 * carries one.
 */
const signIn = (auth, origin, from = origin) =>
  auth.handler(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        origin: from,
        cookie: "_vercel_jwt=x",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: "github",
        callbackURL: "/api/auth-complete?nonce=n",
        disableRedirect: true,
      }),
    })
  );

/**
 * Where the host sends the user back to after GitHub: the `callbackURL` the
 * proxy seals into the `state` it hands GitHub, as the host decrypts it
 */
const returnURL = async (res) => {
  const { symmetricDecrypt } = await import("better-auth/crypto");
  const state = new URL((await res.json()).url).searchParams.get("state");
  const open = async (data) =>
    JSON.parse(await symmetricDecrypt({ key: PROXY_SECRET, data }));
  const { stateCookie } = await open(state);
  return new URL((await open(stateCookie)).callbackURL);
};

describe("oauthProxyPlugins", () => {
  // Cleared for each case: `yarn test-api` loads `.env`
  let restore;
  beforeEach(() => {
    restore = withEnv({
      AUTH_BASE_URL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_URL: undefined,
      VERCEL_BRANCH_URL: undefined,
      AUTH_OAUTH_PROXY_URL: undefined,
      AUTH_OAUTH_PROXY_SECRET: undefined,
      AUTH_SECRET: "a-test-secret-of-at-least-32-bytes!",
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    });
  });
  afterEach(() => restore());

  test("serves a preview on both of its hostnames", async () => {
    asPreview();
    const { deploymentOrigins } = await load();
    assert.deepEqual(deploymentOrigins(), [BRANCH, PREVIEW]);
  });

  test("serves a preview with no branch alias on its deployment URL", async () => {
    asPreview();
    delete process.env.VERCEL_BRANCH_URL;
    const { deploymentOrigins } = await load();
    assert.deepEqual(deploymentOrigins(), [PREVIEW]);
  });

  test("serves AUTH_BASE_URL alone wherever it is set", async () => {
    asHost();
    process.env.VERCEL_URL = PREVIEW_HOST;
    process.env.VERCEL_BRANCH_URL = BRANCH_HOST;
    const { deploymentOrigins } = await load();
    assert.deepEqual(deploymentOrigins(), [HOST]);
  });

  test("allows writes from either of a preview's hostnames", async () => {
    asPreview();
    const { isAllowedOrigin } = await load();
    const from = (origin) => isAllowedOrigin({ headers: { origin } });
    assert.equal(from(BRANCH), true);
    assert.equal(from(PREVIEW), true);
    assert.equal(from(OTHER), false);
  });

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

  // A preview whose proxy URL is one of its own hostnames is the host: it
  // would otherwise complete a payload it forged for itself
  for (const [label, url] of [
    ["branch alias", BRANCH],
    ["deployment URL", PREVIEW],
  ]) {
    test(`is the host when the proxy URL is its ${label}`, async () => {
      asPreview();
      process.env.AUTH_OAUTH_PROXY_URL = url;
      const { oauthProxyPlugins } = await load();
      const [plugin] = oauthProxyPlugins();
      assert.deepEqual(plugin.endpoints, {});
    });
  }

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

  // A single base URL made the other hostname answer INVALID_ORIGIN; the
  // session must also come back to the hostname the user is on, since a
  // cookie set on the other one would leave them signed out here
  for (const [label, origin] of [
    ["branch alias", BRANCH],
    ["deployment URL", PREVIEW],
  ]) {
    test(
      `signs in on a preview's ${label} and returns there`,
      { skip: needsDatabase },
      async () => {
        asPreview();
        const { getAuth } = await load();
        const res = await signIn(getAuth(), origin);
        assert.equal(res.status, 200);
        assert.equal((await returnURL(res)).origin, origin);
      }
    );
  }

  for (const [label, origin, from] of [
    ["on a host that is not the preview's", OTHER, OTHER],
    ["from a page on another site", BRANCH, "https://evil.example"],
  ]) {
    test(`refuses sign-in ${label}`, { skip: needsDatabase }, async () => {
      asPreview();
      const { getAuth } = await load();
      const res = await signIn(getAuth(), origin, from);
      assert.equal(res.status, 403);
    });
  }

  // Falls back to the deployment URL rather than throwing, which answered a
  // 500 on /api/auth and "try again" from every route that reads the session
  test(
    "reads no session on a host that is not the preview's",
    { skip: needsDatabase },
    async () => {
      asPreview();
      const { readSession } = await load();
      const host = new URL(OTHER).host;
      assert.deepEqual(await readSession({ headers: { host } }), {
        status: "signed-out",
      });
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
