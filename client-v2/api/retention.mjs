/**
 * The daily retention job, called by Vercel Cron.
 *
 * Deliberately plain ESM using raw Node request/response APIs, like the rest
 * of `api/` -- see `api/health.mjs` for why.
 */
import { timingSafeEqual } from "node:crypto";

import {
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import { deleteExpiredSessions } from "../src/features/auth/server.mjs";
import { deleteExpiredAudit } from "../src/features/build-server/server.mjs";
import {
  clearDeletedProjectNames,
  query,
} from "../src/features/persistence/server.mjs";
import { cronEnv } from "../src/shared/config/server-env.mjs";
import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:retention");

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * Whether the header is `Bearer <secret>`, compared in constant time.
 * `timingSafeEqual` needs equal lengths, so a length mismatch is refused
 * first; that leaks the secret's length, which is no secret worth keeping.
 *
 * @param {string | undefined} header
 * @param {string} secret
 */
const isBearer = (header, secret) => {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

/**
 * The route, with the three steps passed in; the default export wires the
 * real ones, the tests their own.
 *
 * @param {{
 *   steps: {
 *     sessions: () => Promise<number>;
 *     buildAudit: () => Promise<number>;
 *     projectNames: () => Promise<number>;
 *   };
 * }} deps
 */
export const handleWith = (deps) => async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return sendJson(res, 405, { error: "Use GET." });
  }
  const { CRON_SECRET } = cronEnv();
  if (!CRON_SECRET) {
    // Reported: with no secret the job never runs, and nothing else says so
    log.error(new Error("CRON_SECRET is unset; retention did not run"), {
      report: true,
    });
    return sendJson(res, 503, { error: "The retention job is not configured" });
  }
  if (!isBearer(req.headers.authorization, CRON_SECRET)) {
    // Not reported: anyone can call the route. A run of these in the log
    // beside no "retention ran" means Vercel Cron holds an old secret
    log.warn("retention refused a request without the cron secret");
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  /** @type {Record<string, number>} */
  const counts = {};
  let failed = false;
  // One `try` per step, so a failure does not block the rest
  for (const [name, step] of Object.entries(deps.steps)) {
    try {
      counts[name] = await step();
    } catch (e) {
      failed = true;
      log.error(new Error(`retention step ${name} failed`, { cause: e }), {
        report: true,
      });
    }
  }
  log.info("retention ran", { context: { ...counts, failed } });
  return sendJson(res, failed ? 500 : 200, counts);
};

export default withObservability("retention", (req, res) => {
  warnAboutMissingObservabilityIds();
  return handleWith({
    steps: {
      sessions: () => deleteExpiredSessions(query),
      buildAudit: () => deleteExpiredAudit(query),
      projectNames: clearDeletedProjectNames,
    },
  })(req, res);
});
