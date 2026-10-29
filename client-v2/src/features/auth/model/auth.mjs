/**
 * Better Auth in database mode, over GitHub.
 *
 * Replaced the hand-rolled PKCE/state/cookie flow that used to live in
 * `api/github-oauth.mjs`, exactly as its own FIXME asked. The scope widens from "" to
 * `read:user` because a stateless sign-in needed no identity of its own and a
 * persisted one does. The stable key is the numeric GitHub id -- never the
 * login, which the user can change.
 *
 * Built lazily so the module can be imported with nothing configured: the
 * probe in `/api/sync` and the dev server both need that.
 */
import { betterAuth } from "better-auth";
import { oAuthProxy } from "better-auth/plugins";

import { authEnv } from "../../../shared/config/server-env.mjs";
// TODO(ui-migration 1.4): a feature importing a feature; the auth database adapter needs persistence's pool
import { getPool, isConfigured } from "../../persistence/server.mjs";
import { SIGN_IN_ENV } from "../config.mjs";

let instance = null;

/**
 * What Better Auth builds its callback and redirect URLs from.
 *
 * Production sets `AUTH_BASE_URL` explicitly: one origin. A preview cannot:
 * every deployment gets its own URL and only learns it once it exists, so there
 * is nothing to put in the variable beforehand. Vercel injects the hostnames at
 * runtime instead -- no scheme -- and a preview answers on two of them: the
 * per-deployment `VERCEL_URL` and the branch alias `VERCEL_BRANCH_URL`, which
 * follows the branch's latest deployment. People open both, so a preview gets
 * Better Auth's dynamic base URL: each request resolves to its own `Host`,
 * provided that host is one of these, and each host carries a session of its
 * own. A request on any other host, or with no `Host`, falls back to
 * `VERCEL_URL`, as every request did before the alias was listed: its sign-in
 * is refused as `INVALID_ORIGIN` and its session reads as signed out, rather
 * than Better Auth throwing on every request there.
 *
 * `undefined` rather than `""` when nothing is set, so local development falls
 * through to Better Auth's own default instead of being handed a base URL that
 * is not one.
 *
 * {@link deploymentOrigins} derives the origins `isAllowedOrigin` accepts from
 * this same value, rather than from a second copy of "where we are deployed"
 * that could drift from it: an origin check keyed off a different answer than
 * the cookie's would be a check of nothing in particular.
 *
 * @returns {string | {
 *   allowedHosts: string[];
 *   protocol: "https";
 *   fallback: string;
 * } | undefined} the base URL, the hosts a preview resolves among, or
 * `undefined` to let Better Auth decide
 */
export const resolveBaseURL = () => {
  const { AUTH_BASE_URL, VERCEL_BRANCH_URL, VERCEL_URL } = authEnv();
  if (AUTH_BASE_URL) return AUTH_BASE_URL;

  const allowedHosts = [VERCEL_BRANCH_URL, VERCEL_URL].filter(Boolean);
  if (!allowedHosts.length) return undefined;
  return {
    allowedHosts,
    protocol: "https",
    fallback: `https://${VERCEL_URL ?? VERCEL_BRANCH_URL}`,
  };
};

/**
 * The origins this deployment serves sign-in on: the one `AUTH_BASE_URL`
 * names, or each of a preview's Vercel hostnames. Empty in local development.
 * Reduced to `URL.origin` because `AUTH_BASE_URL` may legitimately carry a
 * path and an `Origin` header never does.
 *
 * @returns {string[]}
 */
export const deploymentOrigins = () => {
  const base = resolveBaseURL();
  if (base === undefined) return [];
  if (typeof base === "string") return [new URL(base).origin];
  return base.allowedHosts.map((host) => `https://${host}`);
};

/**
 * Better Auth's OAuth proxy, so every preview signs in through one GitHub app:
 * a preview sends GitHub to the host's callback (`AUTH_OAUTH_PROXY_URL`), and
 * the host hands the profile back encrypted with `AUTH_OAUTH_PROXY_SECRET`.
 * How it is deployed: `docs/deploy-client-vercel.md`, "Sign-in on previews".
 *
 * Off without the secret. Only a Vercel preview whose proxy URL names another
 * origin completes a proxied sign-in; every other deployment is the host and
 * drops the plugin's endpoints, which turn an encrypted payload into a
 * session. The secret sits in every preview's environment, so on the host they
 * would let whoever holds one sign in as anyone. The role is decided that way
 * round so a production deployment given the proxy URL by mistake still drops
 * them.
 *
 * Exported for tests.
 *
 * @returns {object[]} the plugins to install, empty when the proxy is off
 */
export const oauthProxyPlugins = () => {
  const { AUTH_OAUTH_PROXY_URL, AUTH_OAUTH_PROXY_SECRET, VERCEL_ENV } =
    authEnv();
  if (!AUTH_OAUTH_PROXY_SECRET) return [];

  const base = resolveBaseURL();
  const fixed = typeof base === "string" ? base : undefined;
  const plugin = oAuthProxy({
    productionURL: AUTH_OAUTH_PROXY_URL ?? fixed,
    // The origin the session cookie is issued for. A preview's depends on the
    // request, so it is left to the plugin, which takes the request's origin
    // only when Better Auth trusts it -- here, one of `allowedHosts`.
    currentURL: fixed,
    secret: AUTH_OAUTH_PROXY_SECRET,
  });

  // Parsed last, so a malformed AUTH_BASE_URL on the host fails in Better
  // Auth's own check, which names the value, rather than here
  const proxiesElsewhere = () => {
    const origins = deploymentOrigins();
    return (
      origins.length > 0 &&
      !origins.includes(new URL(AUTH_OAUTH_PROXY_URL).origin)
    );
  };
  const isPreview =
    VERCEL_ENV === "preview" &&
    AUTH_OAUTH_PROXY_URL !== undefined &&
    proxiesElsewhere();
  return [isPreview ? plugin : { ...plugin, endpoints: {} }];
};

/**
 * Whether a state-changing request came from our own deployment.
 *
 * Every route that acts on a signed-in user's behalf calls this before reading
 * the session. The session cookie is `SameSite=Lax`, which keeps it off a
 * cross-site write. That is Better Auth's default rather than a decision made
 * here, and a same-site origin (a sibling subdomain) or a later
 * `sameSite: "none"` would send it. A JSON body is no defence either:
 * `readJson` ignores `content-type`, so a `text/plain` POST needs no preflight.
 * This is the control written down, so the next person to touch cookie
 * attributes finds it.
 *
 * {@link deploymentOrigins} is empty when neither `AUTH_BASE_URL` nor a Vercel
 * hostname is set, which is local development: there is no deployment
 * origin to compare against, so there is no check to make. On a preview,
 * either of its hostnames is ours.
 *
 * A request carrying no `Origin` at all is allowed through. Every browser
 * sends one on PUT, POST and DELETE, so a missing header is a client that had
 * to attach the session cookie itself -- not the attack this guards against.
 * It also keeps the tests honest: `yarn test-api` calls these handlers
 * directly, and making every body-level case fake a header would have each of
 * them assert the header rather than the thing the case is about.
 *
 * @param {import("node:http").IncomingMessage} req
 */
export const isAllowedOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;

  let expected;
  try {
    expected = deploymentOrigins();
  } catch (e) {
    // Refuses every write until fixed; logged, since the 403 names the client
    console.error("auth: AUTH_BASE_URL is not a URL", { message: e?.message });
    return false;
  }
  if (!expected.length) return true;

  try {
    return expected.includes(new URL(origin).origin);
  } catch {
    // An `Origin` we cannot even parse is not one of ours
    return false;
  }
};

/**
 * Which of the settings sign-in needs are absent or unusable.
 *
 * The same list `getAuth` refuses on, so the two cannot drift, and the reason
 * `/api/auth` gives for a 503. Names only, never values: on a platform where
 * every deployment carries its own environment, "which variable is missing
 * here" is the question a deployment cannot answer from the outside, and the
 * names are already in `.env.example` and in this file. An unconfigured
 * deployment is one that does not hold the secrets to begin with.
 *
 * @returns {string[]} the missing variable names, empty when sign-in can run
 */
export const missingConfig = () => {
  const env = authEnv();
  // `DATABASE_URL` is read by the persistence slice, the rest by `authEnv`
  const present = {
    DATABASE_URL: isConfigured(),
    GITHUB_CLIENT_ID: !!env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: !!env.GITHUB_CLIENT_SECRET,
    // Signs the session cookie; a deployment must never fall back to a default
    AUTH_SECRET: !!env.AUTH_SECRET,
  };
  // The OAuth proxy's settings are optional, so not in `SIGN_IN_ENV`; only a
  // half-set or malformed proxy is reported
  const proxyURL = env.AUTH_OAUTH_PROXY_URL;
  return [
    ...SIGN_IN_ENV.filter((name) => !present[name]),
    // A proxy URL alone leaves the proxy off, and the preview then sends GitHub
    // its own callback, which GitHub rejects with nothing said here
    proxyURL && !env.AUTH_OAUTH_PROXY_SECRET ? "AUTH_OAUTH_PROXY_SECRET" : null,
    // Unparseable, it would throw from `getAuth` on every request
    proxyURL && !URL.canParse(proxyURL) ? "AUTH_OAUTH_PROXY_URL" : null,
  ].filter(Boolean);
};

/**
 * The auth instance, created on first use.
 *
 * @returns {ReturnType<typeof betterAuth> | null} the instance, or `null` when
 * the database or the GitHub credentials are missing
 */
export const getAuth = () => {
  if (missingConfig().length) return null;
  const pool = getPool();

  if (!instance) {
    const env = authEnv();
    instance = betterAuth({
      database: pool,
      baseURL: resolveBaseURL(),
      secret: env.AUTH_SECRET,
      plugins: oauthProxyPlugins(),
      user: {
        additionalFields: {
          // The @handle. Better Auth's core schema has `name` and `image` but
          // not the login, and the account row and menu render it. Never an identity
          // key -- a login can be changed; ownership keys off `user.id`.
          login: { type: "string", required: false, input: false },
        },
      },
      socialProviders: {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          // Not applied to a sign-in through the OAuth proxy, whose payload
          // carries only Better Auth's own user fields: a preview's user has
          // no `login` (see "Sign-in on previews" in the deploy doc).
          mapProfileToUser: (profile) => ({ login: profile.login }),
          // Scope is deliberately not set. Better Auth already requests
          // `read:user user:email`, and the option appends rather than
          // replaces -- passing `["read:user"]` only duplicated it in the
          // authorize URL. `user:email` is not droppable either: the `email`
          // column it fills is `not null unique`, so sign-in fails without it
          // for any account whose email is private.
        },
      },
    });
  }
  return instance;
};

/**
 * Who a request is signed in as. Never throws: `unavailable` when building auth
 * or the lookup threw, `unconfigured` when sign-in lacks its settings.
 *
 * A route that spends something on the user's behalf answers `unavailable` with
 * "try again", not "sign in": signing in needs the same lookup. Unverified:
 * which Better Auth failures throw rather than answer `null`; a database outage
 * is assumed to throw.
 *
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<
 *   | { status: "signed-in"; user: { id: string } }
 *   | { status: "signed-out" }
 *   | { status: "unavailable" }
 *   | { status: "unconfigured" }
 * >}
 */
export const readSession = async (req) => {
  try {
    // Inside the `try`: building the instance opens the pool, and a route such
    // as `/api/mcp` must keep serving signed-out callers when that throws
    const auth = getAuth();
    if (!auth) return { status: "unconfigured" };

    const { fromNodeHeaders } = await import("better-auth/node");
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    return session?.user
      ? { status: "signed-in", user: { id: String(session.user.id) } }
      : { status: "signed-out" };
  } catch (e) {
    // Field by field: the platform's console drops an Error's own properties
    console.error("auth: session lookup failed", {
      message: e?.message,
      code: e?.code,
      stack: e?.stack,
    });
    return { status: "unavailable" };
  }
};

/**
 * The signed-in user for a request, or `null`.
 *
 * Fails closed: a failed lookup or unconfigured sign-in reads as signed out,
 * after `readSession` has logged a failure. Use `readSession` where they need
 * different answers.
 *
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<{id: string} | null>}
 */
export const requireUser = async (req) => {
  const session = await readSession(req);
  return session.status === "signed-in" ? session.user : null;
};
