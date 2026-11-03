/**
 * `GET /api/ai/status`: whether an AI key is available to the caller, and
 * whose it would be. The client gates every AI surface on this answer
 * (spec `assistant-ai-status`).
 *
 * The answer never holds a key or any part of one: it says `hosted` or `own`,
 * and names the hosted model, which `GET /api/agent` publishes already.
 *
 * Reached through a `vercel.json` rewrite from `/api/ai/status`: the platform
 * maps a file to one path, and the dev server dispatches `/api/ai/...` to this
 * file by its first segment, so one file serves both.
 *
 * Plain ESM on raw Node request/response APIs — see `api/health.mjs` for why.
 */

import {
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import { missingConfig, readSession } from "../src/features/auth/server.mjs";
import { agentEnv } from "../src/shared/config/server-env.mjs";

/**
 * The answer, one variant per state the client acts on. `available` is about
 * the hosted key only: a key the user brings is the client's to know.
 *
 * @typedef {(
 *   | { available: false; key: "own"; reason: null; model: null }
 *   | { available: true; key: "hosted"; reason: null; model: string }
 *   | {
 *       available: false;
 *       key: "hosted";
 *       reason: "signed-out" | "unavailable";
 *       model: string;
 *     }
 * )} AiStatus
 */

/**
 * No hosted key here: the user supplies their own in settings
 *
 * @type {AiStatus}
 */
// eslint-disable-next-line unicorn/no-null -- the JSON body `AiStatus` defines; `null` survives the wire, `undefined` drops the key
const OWN = { available: false, key: "own", reason: null, model: null };

/**
 * The hosted model's id, or `undefined` when this deployment offers no hosted key.
 *
 * The rule of `api/agent.mjs`'s `GET`, written again here: a key alone is not
 * enough, because without sign-in that route refuses every turn. A case in
 * `ai.test.mjs` holds the two routes to the same answer until that `GET` is
 * retired. Settings only, not `getAuth`: building auth opens the pool, which
 * can throw.
 *
 * TODO: once HOO-1747 has moved the client to this route, retire the `GET` of
 * `api/agent.mjs`, and with it the second copy of this rule, in a ticket of
 * its own.
 */
const hostedModel = () => {
  const agent = agentEnv();
  if (!agent.API_KEY) return undefined;
  const missing = missingConfig();
  if (missing.length > 0) {
    // A key with sign-in half set up is a deployment mistake, not a choice:
    // say which settings are missing (names only, see `missingConfig`)
    console.warn("ai/status: a hosted key is set, but sign-in lacks", missing);
    return undefined;
  }
  return agent.MODEL;
};

/**
 * What the caller can use, from the hosted model and their session.
 *
 * `unavailable` is not `signed-out`: signing in needs the same lookup that
 * just failed, so pointing the user at sign-in would not help.
 *
 * @param {string} model
 * @param {Awaited<ReturnType<typeof readSession>>} session
 * @returns {AiStatus}
 */
const hostedStatus = (model, session) => {
  switch (session.status) {
    case "signed-in":
      // eslint-disable-next-line unicorn/no-null -- the JSON body `AiStatus` defines
      return { available: true, key: "hosted", reason: null, model };
    case "signed-out":
      return { available: false, key: "hosted", reason: "signed-out", model };
    case "unavailable":
      return { available: false, key: "hosted", reason: "unavailable", model };
    default:
      // Defensive: `hostedModel` has just found the sign-in settings
      // complete, so `unconfigured` (or a status `readSession` gains later)
      // means the two checks drifted apart. No turn could be taken, so no
      // hosted key
      console.warn("ai/status: unexpected session status for a hosted key", {
        status: session.status,
      });
      return OWN;
  }
};

const send = (req, res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  // The answer depends on the caller's session cookie
  res.setHeader("cache-control", "no-store");
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
};

/**
 * The route, with the session reader injected so tests reach every caller
 * state without a database.
 *
 * @param {{ readSession: typeof readSession }} deps
 */
export const statusHandler =
  ({ readSession }) =>
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async (req, res) => {
    warnAboutMissingObservabilityIds();
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("allow", "GET, HEAD");
      return send(req, res, 405, {
        error: "Use GET to read whether an AI key is available.",
      });
    }

    const model = hostedModel();
    if (model === undefined) return send(req, res, 200, OWN);

    return send(req, res, 200, hostedStatus(model, await readSession(req)));
  };

export default withObservability("ai", statusHandler({ readSession }));
