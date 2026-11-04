/**
 * Create a gist, secret or public, on the user's GitHub account, and say what
 * happened in the terms the browser acts on.
 *
 * Plain ESM: `/api/gists` runs it as written (see `api/health.mjs`).
 */
import { createServerLogger } from "../../../shared/lib/logger/server.mjs";
import {
  GIST_SCOPE,
  GITHUB_UNAUTHORIZED,
  NEEDS_GIST_SCOPE,
} from "../config.mjs";

const log = createServerLogger("gist:create-gist");

const GISTS_URL = "https://api.github.com/gists";

const fail = (status, reason) => ({ status, body: { reason } });

/**
 * Whether GitHub refused for want of requests rather than of permission.
 *
 * A 429 always; on a 403, a primary limit says so in
 * `x-ratelimit-remaining: 0` and a secondary one only in its message (and
 * sometimes `retry-after`). Checked before the scope, because a rate-limited
 * 403 carries `x-oauth-scopes` too and, for a token without `gist`, would be
 * misread as the missing scope.
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
    log.warn("unreadable GitHub answer", {
      context: { status: response.status, reason: e?.message },
    });
    return "";
  }
};

/**
 * Build `createGist` over a sender, so a test hands it a fake `fetch` first.
 *
 * @param {typeof fetch} send
 * @returns the function below:
 * `({token, description, files, public}) => Promise<{status: number, body: object}>`;
 * `token` is the user's GitHub access token and is never returned, `description`
 * is the project name, `files` are already flattened, `public` says whether the
 * gist is listed on the user's profile (a secret one still opens for anyone with
 * its link). It answers `201 {url, id}`,
 * or a status with a `reason` (see the `gist-sharing` spec)
 */
export const createGistWith =
  (send) =>
  async ({ token, description, files, public: visibility }) => {
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
        body: JSON.stringify({ description, public: visibility, files }),
      });
    } catch (e) {
      log.error(e, { context: { during: "GitHub request" } });
      return fail(502, "request-failed");
    }

    if (response.status === 201) {
      let gist;
      try {
        gist = await response.json();
      } catch (e) {
        log.error(e, { context: { during: "reading GitHub's 201" } });
        return fail(502, "request-failed");
      }
      if (typeof gist?.html_url !== "string" || typeof gist?.id !== "string") {
        log.error(new Error("GitHub's 201 named no gist"), { report: true });
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
      log.warn("GitHub rejected the gist", { context: { message } });
      return fail(422, "rejected");
    }

    log.error(new Error("unexpected GitHub answer"), {
      report: true,
      context: { status: response.status, message },
    });
    return fail(502, "request-failed");
  };

/** `createGist` over the runtime's `fetch` */
export const createGist = createGistWith((...args) => fetch(...args));
