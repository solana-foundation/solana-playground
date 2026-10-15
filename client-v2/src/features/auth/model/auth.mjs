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

import { authEnv } from "../../../shared/config/server-env.mjs";
import { getPool, isConfigured } from "../../persistence/server.mjs";
import { SIGN_IN_ENV } from "../config.mjs";

let instance = null;

/**
 * The origin Better Auth builds its callback and redirect URLs from.
 *
 * Production sets `AUTH_BASE_URL` explicitly. A preview cannot: every deployment
 * gets its own URL and only learns it once it exists, so there is nothing to put
 * in the variable beforehand. Vercel injects that URL at runtime as `VERCEL_URL`
 * -- hostname only, no scheme -- which lets a preview describe itself and need
 * no configuration at all.
 *
 * `undefined` rather than `""` when neither is set, so local development falls
 * through to Better Auth's own default instead of being handed a base URL that
 * is not one.
 *
 * {@link isAllowedOrigin} compares it against a request's `Origin` for
 * `/api/agent`, `/api/mcp` and the sync routes. Deliberately the same value the session
 * cookie is issued for, rather than a second copy of "where we are deployed"
 * that could drift from it: an origin check keyed off a different answer than
 * the cookie's would be a check of nothing in particular.
 *
 * @returns {string | undefined} the origin, or `undefined` to let Better Auth decide
 */
export const resolveBaseURL = () => {
  const { AUTH_BASE_URL, VERCEL_URL } = authEnv();
  return AUTH_BASE_URL || (VERCEL_URL ? `https://${VERCEL_URL}` : undefined);
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
 * `resolveBaseURL()` is `undefined` when neither `AUTH_BASE_URL` nor
 * `VERCEL_URL` is set, which is local development: there is no deployment
 * origin to compare against, so there is no check to make. Both sides are
 * reduced to `URL.origin` because `AUTH_BASE_URL` may legitimately carry a
 * path and an `Origin` header never does.
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
  const expected = resolveBaseURL();
  const origin = req.headers.origin;
  if (!expected || !origin) return true;

  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    // An `Origin` we cannot even parse is not one of ours
    return false;
  }
};

/**
 * Which of the settings sign-in needs are absent.
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
  return SIGN_IN_ENV.filter((name) => !present[name]);
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
      user: {
        additionalFields: {
          // The @handle. Better Auth's core schema has `name` and `image` but
          // not the login, and the profile chip renders it. Never an identity
          // key -- a login can be changed; ownership keys off `user.id`.
          login: { type: "string", required: false, input: false },
        },
      },
      socialProviders: {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
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
