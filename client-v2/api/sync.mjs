/**
 * Capability probe for conversation and project sync.
 *
 * Same shape as `/api/agent`'s discovery GET: the client asks whether the
 * feature is available and falls back to purely local behaviour when it is
 * not. That is what lets this ship dark.
 *
 * Deliberately plain ESM using raw Node request/response APIs, like the rest
 * of `api/` -- see `api/health.mjs` for why.
 */
import { warnAboutMissingObservabilityIds } from "../src/features/api/server/observability.mjs";
import { withObservability } from "../src/features/api/server/with-observability.mjs";
import {
  isConfigured,
  isEnabled,
  query,
} from "../src/features/persistence/server.mjs";

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handler(req, res) {
  warnAboutMissingObservabilityIds();
  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (!isConfigured()) {
    return sendJson(res, 200, { enabled: false, db: "unconfigured" });
  }

  try {
    await query("select 1");
    return sendJson(res, 200, { enabled: isEnabled(), db: "ok" });
  } catch {
    // Deliberately no detail: a connection error message carries the host, and
    // sometimes the credentials, of the database
    return sendJson(res, 200, { enabled: false, db: "unreachable" });
  }
}

export default withObservability("sync", handler);
