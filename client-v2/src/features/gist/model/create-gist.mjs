/**
 * Create a public gist on the user's GitHub account, and say what happened in
 * the terms the browser acts on.
 *
 * Plain ESM: `/api/gists` runs it as written (see `api/health.mjs`).
 */
import {
  GIST_SCOPE,
  GITHUB_UNAUTHORIZED,
  NEEDS_GIST_SCOPE,
} from "../config.mjs";

const GISTS_URL = "https://api.github.com/gists";

const fail = (status, reason) => ({ status, body: { reason } });

/**
 * Whether GitHub refused for want of requests rather than of permission.
 *
 * A primary limit says so in `x-ratelimit-remaining: 0`; a secondary one only
 * in its message (and sometimes `retry-after`), both on a 403. Checked before
 * the scope, because a rate-limited 403 carries `x-oauth-scopes` too and,
 * for a token without `gist`, would be misread as the missing scope.
 */
const isRateLimited = (response, message) =>
  response.status === 429 ||
  (response.status === 403 &&
    (response.headers.get("x-ratelimit-remaining") === "0" ||
      response.headers.has("retry-after") ||
      /rate limit/i.test(message)));

/**
 * Whether the token's scopes, as GitHub lists them on every answer, lack
 * `gist`. GitHub answers a token without it with a 404 on `POST /gists`, which
 * also means other things, so the header decides; no header, no verdict.
 * Sign-in is an OAuth app, whose tokens always carry the header; a GitHub App
 * or fine-grained token would not, and would land on `request-failed`.
 */
const lacksGistScope = (response) => {
  const scopes = response.headers.get("x-oauth-scopes");
  if (scopes === null) return false;
  return !scopes
    .split(",")
    .map((scope) => scope.trim())
    .includes(GIST_SCOPE);
};

/** GitHub's `message`, for telling its 403s apart; never sent on */
const messageOf = async (response) => {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : "";
  } catch (e) {
    // A body that is not JSON carries no message to read; the status decides
    console.warn("gist: unreadable GitHub answer", {
      status: response.status,
      message: e?.message,
    });
    return "";
  }
};

/**
 * @param {object} args
 * @param {string} args.token the user's GitHub access token; never returned
 * @param {string} args.description the gist's description, the project name
 * @param {Record<string, {content: string}>} args.files already flattened
 * @param {typeof fetch} [args.fetch]
 * @returns {Promise<{status: number, body: object}>} `201 {url, id}`, or a
 * status with a `reason` (see the `gist-sharing` spec)
 */
export const createGist = async ({
  token,
  description,
  files,
  fetch: send = fetch,
}) => {
  let response;
  try {
    response = await send(GISTS_URL, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "solana-playground",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ description, public: true, files }),
    });
  } catch (e) {
    console.error("gist: GitHub request failed", { message: e?.message });
    return fail(502, "request-failed");
  }

  if (response.status === 201) {
    let gist;
    try {
      gist = await response.json();
    } catch (e) {
      console.error("gist: unreadable 201 from GitHub", {
        message: e?.message,
      });
      return fail(502, "request-failed");
    }
    if (typeof gist?.html_url !== "string" || typeof gist?.id !== "string") {
      console.error("gist: GitHub's 201 named no gist");
      return fail(502, "request-failed");
    }
    return { status: 201, body: { url: gist.html_url, id: gist.id } };
  }

  if (response.status === 401) return fail(401, GITHUB_UNAUTHORIZED);

  const message = await messageOf(response);
  if (isRateLimited(response, message)) return fail(429, "rate-limited");
  if (
    (response.status === 403 || response.status === 404) &&
    lacksGistScope(response)
  ) {
    return fail(403, NEEDS_GIST_SCOPE);
  }
  if (response.status === 422) {
    console.warn("gist: GitHub rejected the gist", { message });
    return fail(422, "rejected");
  }

  console.error("gist: unexpected GitHub answer", {
    status: response.status,
    message,
  });
  return fail(502, "request-failed");
};
