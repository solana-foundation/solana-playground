/**
 * Share a project as a public gist on the user's own GitHub account.
 *
 * The browser flattens the project (`features/gist/lib/format.ts`) and posts
 * the gist's files; this route holds the user's GitHub token, which Better
 * Auth stored at sign-in, and never lets it reach the browser.
 *
 * Deliberately plain ESM using raw Node request/response APIs, like the rest
 * of `api/` -- see `api/health.mjs` for why.
 */
import {
  getAuth,
  isAllowedOrigin,
  readSession,
  SIGNED_OUT_REASON,
} from "../src/features/auth/server.mjs";
import {
  readJson,
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import {
  createGist,
  GITHUB_UNAUTHORIZED,
  MAX_DESCRIPTION,
  MAX_GIST_BYTES,
  MAX_GIST_FILES,
} from "../src/features/gist/server.mjs";

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * The body's shape, or why it is not one: `malformed` is a 400, `too-large`
 * a 413. Sizes are re-checked here although the browser checks them first,
 * because the browser is not the only thing that can post.
 *
 * @returns {{description: string, files: Record<string, {content: string}>} | {error: "malformed" | "too-large"}}
 */
const parseGist = (body) => {
  const { description, files } = body;
  if (typeof description !== "string" || description.length > MAX_DESCRIPTION) {
    return { error: "malformed" };
  }
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return { error: "malformed" };
  }
  const entries = Object.entries(files);
  if (!entries.length) return { error: "malformed" };
  const wellFormed = entries.every(
    ([name, file]) =>
      name !== "" &&
      !name.includes("/") &&
      typeof file?.content === "string" &&
      file.content !== ""
  );
  if (!wellFormed) return { error: "malformed" };

  // The manifest is one of them, hence `+ 1`
  if (entries.length > MAX_GIST_FILES + 1) return { error: "too-large" };
  let bytes = 0;
  for (const [, file] of entries) bytes += Buffer.byteLength(file.content);
  if (bytes > MAX_GIST_BYTES) return { error: "too-large" };

  return { description, files };
};

/** Thrown when the user has no GitHub grant we can use: signing in again mends it */
export class NoGithubGrant extends Error {
  constructor(message) {
    super(message);
    this.name = "NoGithubGrant";
  }
}

/** Better Auth's codes for "this user has no usable GitHub token" */
const NO_GRANT_CODES = new Set([
  "ACCOUNT_NOT_FOUND",
  "FAILED_TO_GET_ACCESS_TOKEN",
]);

/**
 * The user's GitHub access token, refreshed by Better Auth if it must be.
 *
 * @param {string} userId
 * @returns {Promise<string>} throws {@link NoGithubGrant} when the user has
 * no usable GitHub account; anything else it throws is ours (the database,
 * the configuration), not the user's to mend by signing in
 */
const getAccessToken = async (userId) => {
  const auth = getAuth();
  if (!auth) throw new Error("Sign-in is not configured");
  let accessToken;
  try {
    ({ accessToken } = await auth.api.getAccessToken({
      body: { providerId: "github", userId },
    }));
  } catch (e) {
    if (NO_GRANT_CODES.has(e?.body?.code)) throw new NoGithubGrant(e.body.code);
    throw e;
  }
  if (!accessToken) throw new NoGithubGrant("No GitHub access token stored");
  return accessToken;
};

/**
 * The route, with what it calls passed in, so `api/gists.test.mjs` can drive
 * every answer without a database or GitHub.
 */
export const createHandler =
  (deps) =>
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async (req, res) => {
    if (req.method !== "POST") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }
    // Ahead of the session lookup: a request from somewhere else is refused on
    // its own terms, whoever it turns out to be signed in as
    if (!deps.isAllowedOrigin(req)) {
      return sendJson(res, 403, { error: "Cross-origin request refused" });
    }

    const session = await deps.readSession(req);
    if (session.status === "signed-out") {
      return sendJson(res, 401, {
        error: "Not signed in",
        reason: SIGNED_OUT_REASON,
      });
    }
    if (session.status !== "signed-in") {
      // `unconfigured` or `unavailable`: neither is the user's to fix by
      // signing in, and `readSession` has logged the second
      return sendJson(res, 503, { error: "Sign-in is unavailable" });
    }

    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: "Expected a JSON object" });
    }
    const gist = parseGist(body);
    if (gist.error === "too-large") {
      return sendJson(res, 413, { error: "Too large for a gist" });
    }
    if (gist.error) return sendJson(res, 400, { error: "Malformed gist" });

    let token;
    try {
      token = await deps.getAccessToken(session.user.id);
    } catch (e) {
      if (e instanceof NoGithubGrant) {
        // Signed in to us, but GitHub's grant is gone: signing in again
        // stores a fresh token
        console.warn("gists: no usable GitHub token", { message: e.message });
        return sendJson(res, 401, {
          error: "GitHub authorization is missing",
          reason: GITHUB_UNAUTHORIZED,
        });
      }
      // The database or the configuration: a new sign-in would not help
      console.error("gists: could not read the GitHub token", {
        message: e?.message,
        stack: e?.stack,
      });
      return sendJson(res, 503, { error: "Sign-in is unavailable" });
    }

    const { status, body: answer } = await deps.createGist({
      token,
      description: gist.description,
      files: gist.files,
    });
    return sendJson(res, status, answer);
  };

const handler = createHandler({
  isAllowedOrigin,
  readSession,
  getAccessToken,
  createGist,
});

export default withObservability("gists", async (req, res) => {
  warnAboutMissingObservabilityIds();
  return handler(req, res);
});
