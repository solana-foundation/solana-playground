/**
 * Learn a user's GitHub account creation date after a turn, for everyone
 * sign-in did not cover: users created before `"user"."githubCreatedAt"`
 * existed, and users signed in through the OAuth proxy on a preview, whose
 * sign-in skips `mapProfileToUser`.
 *
 * The route calls this only once the response has ended, so GitHub's latency
 * reaches no answer. A read that fails stores nothing; the user stays a
 * `newcomer` and the next turn tries again.
 */

import { createServerLogger } from "../../../shared/lib/logger/server.mjs";

const log = createServerLogger("agent:account-age");

/** Never overwrites: the date never changes, and sign-in may have stored it */
const STORE = `update "user" set "githubCreatedAt" = $2
                where id = $1 and "githubCreatedAt" is null`;

/** Long enough for GitHub on a bad day, short enough not to hold the function */
const TIMEOUT_MS = 5000;

/**
 * Why a lookup stored nothing
 *
 * - `no-token`: the user holds no GitHub token
 * - `token-unreadable`: reading it failed on our side (a token that no longer
 *   decrypts, sign-in unconfigured, the database)
 * - `refused`, `unreachable`, `malformed`: GitHub did not answer usefully
 * - `database`: storing the date failed
 *
 * @typedef {"no-token" | "token-unreadable" | "refused" | "unreachable" | "malformed" | "database"} SkipReason
 */

/**
 * Read GitHub's `GET /user` with the user's own token and store `created_at`,
 * giving GitHub `timeoutMs` to answer: the route takes {@link learnAccountAge},
 * and tests a shorter wait. Never throws: the caller has already answered and
 * has nobody to tell.
 *
 * The token comes from `readToken`, never from the `account` table: Better
 * Auth stores it encrypted, and only the route holds the auth instance that
 * decrypts it.
 *
 * @param {number} timeoutMs
 * @returns {(deps: {
 *   query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
 *   readToken: (userId: string) => Promise<string | undefined>;
 * }, userId: string) => Promise<{ outcome: "stored"; createdAt: Date }
 *   | { outcome: "skipped"; reason: SkipReason }>} `readToken` answers
 * `undefined` when the user holds no GitHub token, and throws only for a
 * failure of ours (a token that no longer decrypts, the configuration, the
 * database)
 */
export const learnAccountAgeWith =
  (timeoutMs) =>
  async ({ query, readToken }, userId) => {
    const skipped = (reason, detail) => {
      log.warn("account age not learned", {
        context: { userId, reason, detail },
      });
      return { outcome: "skipped", reason };
    };

    let token;
    try {
      token = await readToken(userId);
    } catch (e) {
      // Ours, not the user's, and reported: after a change of AUTH_SECRET every
      // user stays undated until they sign in again
      log.error(e, {
        report: true,
        context: { userId, reason: e?.reason, code: e?.code },
      });
      return { outcome: "skipped", reason: "token-unreadable" };
    }
    if (!token) return skipped("no-token");

    try {
      let response;
      try {
        response = await fetch("https://api.github.com/user", {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "solana-playground",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        return skipped("unreachable", e?.message);
      }
      if (!response.ok) return skipped("refused", response.status);

      let profile;
      try {
        profile = await response.json();
      } catch (e) {
        // Only the error's name: V8's `SyntaxError` quotes the body it failed
        // on, and the body is the user's GitHub profile
        return skipped("malformed", e?.name);
      }
      const createdAt = new Date(profile?.created_at ?? NaN);
      if (Number.isNaN(createdAt.getTime())) return skipped("malformed");

      await query(STORE, [userId, createdAt]);
      return { outcome: "stored", createdAt };
    } catch (e) {
      // The database, not GitHub: the same "try again next turn" answer, but an
      // error, since the ledger on the same database may be failing too
      log.error(e, { report: true, context: { userId, code: e?.code } });
      return { outcome: "skipped", reason: "database" };
    }
  };

/** Reads the age with GitHub given `TIMEOUT_MS` to answer */
export const learnAccountAge = learnAccountAgeWith(TIMEOUT_MS);
