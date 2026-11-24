/**
 * `DELETE /api/account`: erase the signed-in user's account.
 *
 * Deliberately plain ESM using raw Node request/response APIs, like the rest
 * of `api/` -- see `api/health.mjs` for why. The route composes the slices:
 * it opens the transaction and runs the build audit's scrub and the `user`
 * delete in it, since a feature may not import another.
 */
import {
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import {
  getAuth,
  isAllowedOrigin,
  missingConfig,
  readGithubTokenWith,
  readSession,
  revokeGithubGrantWith,
  sessionCookieExpiry,
} from "../src/features/auth/server.mjs";
import { scrubIdentity } from "../src/features/build-server/server.mjs";
import { transaction } from "../src/features/persistence/server.mjs";
import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:account");

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * The route, with what it reaches outside itself passed in; the default
 * export wires the real ones, the tests their own.
 *
 * @param {{
 *   missingConfig: typeof missingConfig;
 *   isAllowedOrigin: typeof isAllowedOrigin;
 *   readSession: typeof readSession;
 *   readGithubToken: ReturnType<typeof readGithubTokenWith>;
 *   revokeGithubGrant: ReturnType<typeof revokeGithubGrantWith>;
 *   sessionCookieExpiry: typeof sessionCookieExpiry;
 *   transaction: typeof transaction;
 * }} deps
 */
export const handleWith = (deps) => async (req, res) => {
  if (req.method !== "DELETE") {
    res.setHeader("allow", "DELETE");
    return sendJson(res, 405, { error: "Use DELETE." });
  }
  if (deps.missingConfig().length) {
    return sendJson(res, 503, { error: "Sign-in is not configured" });
  }
  if (!deps.isAllowedOrigin(req)) {
    return sendJson(res, 403, { error: "Cross-origin request refused" });
  }
  const session = await deps.readSession(req);
  if (session.status === "unavailable" || session.status === "unconfigured") {
    return sendJson(res, 503, { error: "Sign-in is unavailable" });
  }
  if (session.status !== "signed-in") {
    return sendJson(res, 401, { error: "Sign in first" });
  }
  const userId = session.user.id;

  // Before the delete: the cascade removes the account row that holds it
  /** @type {{ status: "read"; token: string } | { status: "failed" }} */
  let tokenRead;
  try {
    tokenRead = { status: "read", token: await deps.readGithubToken(userId) };
  } catch (e) {
    log.error(new Error("could not read the GitHub token", { cause: e }), {
      report: true,
    });
    tokenRead = { status: "failed" };
  }

  try {
    // The delete first: it waits for a build's audit insert that locked the
    // user row, so the scrub after it sees that row (`startAuditWith`)
    await deps.transaction(async (q) => {
      await q(`delete from "user" where id = $1`, [userId]);
      await scrubIdentity(q, userId);
    });
  } catch (e) {
    log.error(new Error("account deletion failed", { cause: e }), {
      report: true,
    });
    return sendJson(res, 500, { error: "Could not delete the account" });
  }

  // After the commit, the account is gone whatever happens next, so the
  // answer is a 200: a 500 would tell the person it still stands
  let githubRevoked = false;
  try {
    // A revoke before the commit, followed by a failed transaction, would
    // leave an account that can no longer reach GitHub. A token read that
    // failed was reported already; the revoke would only report it again
    if (tokenRead.status === "read") {
      githubRevoked = await deps.revokeGithubGrant(tokenRead.token);
    }
  } catch (e) {
    log.error(new Error("the GitHub grant revocation threw", { cause: e }), {
      report: true,
    });
  }
  try {
    const cookies = await deps.sessionCookieExpiry(req);
    if (cookies.length) res.setHeader("set-cookie", cookies);
  } catch (e) {
    // The session row went with the account, so the next request reads as
    // signed out even with the cookie left
    log.error(new Error("could not clear the session cookie", { cause: e }), {
      report: true,
    });
  }
  return sendJson(res, 200, { githubRevoked });
};

export default withObservability("account", (req, res) => {
  warnAboutMissingObservabilityIds();
  return handleWith({
    missingConfig,
    isAllowedOrigin,
    readSession,
    readGithubToken: readGithubTokenWith(getAuth),
    revokeGithubGrant: revokeGithubGrantWith((...args) => fetch(...args)),
    sessionCookieExpiry,
    transaction,
  })(req, res);
});
