import { warnAboutMissingObservabilityIds } from "../src/features/api/server/observability.mjs";
import { withObservability } from "../src/features/api/server/with-observability.mjs";

/**
 * Liveness probe for the API harness.
 *
 * Deliberately plain ESM using raw Node request/response APIs. Two reasons:
 * `api/` sits outside the app's TypeScript build (`tsconfig.json` includes
 * `src` only, so TS here would be unchecked anyway), and `VercelResponse`
 * extends Node's `ServerResponse`, so one function runs unchanged under the
 * craco dev server, `vercel dev`, and a real deployment.
 *
 * A stopgap. The moment this app moves to a framework that owns its own API
 * routes, these handlers belong there instead.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
function handler(req, res) {
  warnAboutMissingObservabilityIds();
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      ok: true,
      node: process.version,
      at: new Date().toISOString(),
    })
  );
}

export default withObservability("health", handler);
