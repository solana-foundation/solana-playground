/**
 * The user's GitHub access token, read through Better Auth.
 *
 * The `account` row holds the token encrypted with `AUTH_SECRET`
 * (`ACCOUNT_OPTIONS` in `auth.mjs`), so no route reads `"accessToken"` with
 * SQL: Better Auth's `getAccessToken` decrypts it, and returns a row written
 * before encryption as it is. Only the one-off backfill,
 * `scripts/db/encrypt-github-tokens.mjs`, reads the column directly, to
 * encrypt it.
 */

/**
 * Why the user holds no usable GitHub token:
 *
 * - `no-account`: no GitHub account row
 * - `unreadable`: Better Auth could not produce the stored token; one that no
 *   longer decrypts, after `AUTH_SECRET` changed, is the expected case
 * - `empty`: the row holds no token
 *
 * @typedef {"no-account" | "unreadable" | "empty"} NoGrantReason
 */

/** Thrown when the user has no GitHub grant we can use: signing in again mends it */
export class NoGithubGrant extends Error {
  /**
   * @param {NoGrantReason} reason
   * @param {unknown} cause Better Auth's own error, kept so a log of an
   * `unreadable` token says what failed; `undefined` when there is none
   */
  constructor(reason, cause) {
    super(reason, { cause });
    this.name = "NoGithubGrant";
    /** @type {NoGrantReason} */
    this.reason = reason;
  }
}

/**
 * Better Auth's codes for "this user has no usable GitHub token", by reason.
 * `FAILED_TO_GET_ACCESS_TOKEN` is the catch-all of Better Auth's
 * `getValidAccessToken`: a token that does not decrypt, but also a failed
 * refresh or a failed write of the refreshed row. GitHub's OAuth tokens do
 * not expire, so for this provider it means a token that no longer decrypts.
 *
 * @type {Record<string, NoGrantReason>}
 */
const NO_GRANT_REASONS = {
  ACCOUNT_NOT_FOUND: "no-account",
  FAILED_TO_GET_ACCESS_TOKEN: "unreadable",
};

/**
 * The user's GitHub access token, refreshed by Better Auth if it must be.
 *
 * Better Auth 1.7 selects the account by its row id (`accountId`), not by
 * provider: a `providerId` body fails its schema and throws before any token
 * is read. So the GitHub row is found first.
 *
 * @param {{$context: Promise<any>, api: {getAccessToken: Function}}} auth
 * @param {string} userId
 * @returns {Promise<string>} throws {@link NoGithubGrant} when the user has
 * no usable GitHub token; anything else it throws is ours (the database,
 * the configuration), not the user's to mend by signing in
 */
export const readGithubToken = async (auth, userId) => {
  const { internalAdapter } = await auth.$context;
  const accounts = await internalAdapter.findAccounts(userId);
  const github = accounts.find((a) => a.providerId === "github");
  if (!github) throw new NoGithubGrant("no-account", undefined);
  let accessToken;
  try {
    ({ accessToken } = await auth.api.getAccessToken({
      body: { accountId: github.id, userId },
    }));
  } catch (e) {
    const reason = NO_GRANT_REASONS[e?.body?.code];
    if (reason) throw new NoGithubGrant(reason, e);
    throw e;
  }
  if (!accessToken) throw new NoGithubGrant("empty", undefined);
  return accessToken;
};

/**
 * {@link readGithubToken} over the auth instance `loadAuth` builds, which is
 * how a route reads the token: `readGithubTokenWith(getAuth)`. A route that
 * glued the two by hand once forgot to await `getAuth`, and every read threw.
 *
 * @param {() => Promise<object | null>} loadAuth `getAuth`, which answers
 * `null` when sign-in is not configured
 * @returns {(userId: string) => Promise<string>} throws {@link NoGithubGrant}
 * as `readGithubToken` does, and an `Error` when sign-in is not configured
 */
export const readGithubTokenWith = (loadAuth) => async (userId) => {
  const auth = await loadAuth();
  if (!auth) throw new Error("Sign-in is not configured");
  return readGithubToken(auth, userId);
};
