/**
 * What deleting an account needs from Better Auth and GitHub: the revocation
 * of the OAuth grant the user's GitHub token belongs to, the session cookie's
 * expiry, and the retention job's delete of expired sessions.
 */
import { fromNodeHeaders } from "better-auth/node";

import { authEnv } from "../../../shared/config/server-env.mjs";
import { createServerLogger } from "../../../shared/lib/logger/server.mjs";
import { getAuth } from "./auth.mjs";

const log = createServerLogger("auth:account");

/** How long GitHub may take to answer the revocation */
const REVOKE_TIMEOUT_MS = 5_000;

/**
 * Ask GitHub to revoke the OAuth grant a token belongs to, which removes the
 * app from the user's authorised applications. Never throws and never logs
 * the token: a failure is reported and answers `false`.
 *
 * @param {typeof fetch} fetchImpl
 * @returns {(token: string | undefined) => Promise<boolean>} whether GitHub
 * answered `204`
 */
export const revokeGithubGrantWith = (fetchImpl) => async (token) => {
  if (!token) {
    log.error(new Error("no GitHub token to revoke the grant with"), {
      report: true,
    });
    return false;
  }
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = authEnv();
  try {
    const response = await fetchImpl(
      `https://api.github.com/applications/${GITHUB_CLIENT_ID}/grant`,
      {
        method: "DELETE",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Basic ${Buffer.from(
            `${GITHUB_CLIENT_ID}:${GITHUB_CLIENT_SECRET}`
          ).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: token }),
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      }
    );
    if (response.status === 204) return true;
    log.error(new Error(`GitHub answered ${response.status} to the revoke`), {
      report: true,
    });
    return false;
  } catch (e) {
    log.error(new Error("the GitHub grant revocation failed", { cause: e }), {
      report: true,
    });
    return false;
  }
};

/**
 * The `Set-Cookie` values that end the request's session in the browser,
 * from Better Auth's own sign-out, which tolerates a session row that no
 * longer exists. Never throws: on a failure the cookie stays, and the next
 * request reads as signed out because the session row is gone.
 *
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string[]>}
 */
export const sessionCookieExpiry = async (req) => {
  try {
    const auth = await getAuth();
    if (!auth) return [];
    const response = await auth.api.signOut({
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    return response.headers.getSetCookie();
  } catch (e) {
    log.warn("could not clear the session cookie after account deletion", {
      context: { message: e instanceof Error ? e.message : String(e) },
    });
    return [];
  }
};

/**
 * Delete every session whose `expiresAt` has passed. Run daily by the
 * retention job.
 *
 * @param {(text: string, params?: unknown[]) => Promise<{ rowCount: number | null }>} query
 * @returns {Promise<number>} how many rows were deleted
 */
export const deleteExpiredSessions = async (query) => {
  const { rowCount } = await query(
    `delete from session where "expiresAt" < now()`
  );
  return rowCount ?? 0;
};
