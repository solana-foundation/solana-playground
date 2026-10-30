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

/** The token GitHub issued at sign-in; Better Auth stores it unencrypted */
const TOKEN = `select "accessToken" from account
                where "userId" = $1 and "providerId" = 'github'
                  and "accessToken" is not null
                order by "updatedAt" desc
                limit 1`;

/** Never overwrites: the date never changes, and sign-in may have stored it */
const STORE = `update "user" set "githubCreatedAt" = $2
                where id = $1 and "githubCreatedAt" is null`;

/** Long enough for GitHub on a bad day, short enough not to hold the function */
const TIMEOUT_MS = 5000;

/**
 * Why a lookup stored nothing
 *
 * @typedef {"no-token" | "refused" | "unreachable" | "malformed" | "database"} SkipReason
 */

/**
 * Read GitHub's `GET /user` with the user's own token and store `created_at`.
 * Never throws: the caller has already answered and has nobody to tell.
 *
 * @param {(text: string, params?: unknown[]) => Promise<{ rows: any[] }>} query
 * @param {string} userId
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ outcome: "stored"; createdAt: Date }
 *   | { outcome: "skipped"; reason: SkipReason }>}
 */
export const learnAccountAge = async (query, userId, options = {}) => {
  const skipped = (reason, detail) => {
    console.warn("agent: account age not learned", { userId, reason, detail });
    return { outcome: "skipped", reason };
  };

  try {
    const { rows } = await query(TOKEN, [userId]);
    const token = rows[0]?.accessToken;
    if (!token) return skipped("no-token");

    let response;
    try {
      response = await fetch("https://api.github.com/user", {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "solana-playground",
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
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
    // The database, not GitHub: the same "try again next turn" answer, but
    // an error, since the ledger on the same database may be failing too
    console.error("agent: account age lookup failed", {
      userId,
      message: e?.message,
      code: e?.code,
    });
    return { outcome: "skipped", reason: "database" };
  }
};
