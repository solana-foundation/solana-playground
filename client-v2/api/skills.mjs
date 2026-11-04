// @ts-check
/**
 * The skills this deployment offers the caller.
 *
 * `GET` answers `{ skills }`: the `skill` entries of `SOURCES_CATALOGUE`, or
 * of `SOURCES`, filled from the environment. The browser lists what this
 * returns and nothing else, so a skill the operator withholds is absent for
 * every backend. A separate route from `/api/mcp`, whose answers every MCP
 * client reads.
 *
 * Plain ESM on raw Node request/response APIs — see `api/health.mjs` for why.
 */

import {
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import { isAllowedOrigin, readSession } from "../src/features/auth/server.mjs";
import { composeSkills } from "../src/features/skills/server.mjs";
import { sourcesEnv } from "../src/shared/config/server-env.mjs";
import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:skills");

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/** @param {boolean} signedIn */
const compose = (signedIn) =>
  composeSkills({
    env: process.env,
    override: sourcesEnv().SOURCES,
    signedIn,
  });

/**
 * The skills this request is offered.
 *
 * @param {import("node:http").IncomingMessage} req
 */
const offered = async (req) => {
  const full = compose(true);
  const open = compose(false);
  // The session is a database read, so it is looked up only when a `signedIn` entry makes it matter
  if (full.length === open.length) return open;
  // The origin first, so another site cannot borrow a visitor's session
  const signedIn =
    isAllowedOrigin(req) && (await readSession(req)).status === "signed-in";
  return signedIn ? full : open;
};

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handler(req, res) {
  warnAboutMissingObservabilityIds();

  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return sendJson(res, 405, { error: "Use GET to list skills." });
  }

  try {
    return sendJson(res, 200, { skills: await offered(req) });
  } catch (e) {
    // A broken catalogue fails every request, with the entry at fault named, rather than serving part of it
    log.error(e, { report: true });
    return sendJson(res, 500, { error: /** @type {Error} */ (e).message });
  }
}

export default withObservability("skills", handler);
