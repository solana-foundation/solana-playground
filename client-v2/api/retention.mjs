/**
 * The daily retention job, called by Vercel Cron.
 *
 * Deliberately plain ESM using raw Node request/response APIs, like the rest
 * of `api/` -- see `api/health.mjs` for why.
 */
import {
  refuseCronFor,
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import { deleteExpiredSessions } from "../src/features/auth/server.mjs";
import { deleteExpiredAudit } from "../src/features/build-server/server.mjs";
import {
  clearDeletedProjectNames,
  query,
} from "../src/features/persistence/server.mjs";
import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:retention");

const refuse = refuseCronFor("retention");

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
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
  if (refuse(req, res)) return;

  /** @type {Record<string, number>} */
  const counts = {};
  let hasFailed = false;
  // One `try` per step, so a failure does not block the rest
  for (const [name, step] of Object.entries(deps.steps)) {
    try {
      counts[name] = await step();
    } catch (e) {
      hasFailed = true;
      log.error(new Error(`retention step ${name} failed`, { cause: e }), {
        report: true,
      });
    }
  }
  log.info("retention ran", { context: { ...counts, failed: hasFailed } });
  return sendJson(res, hasFailed ? 500 : 200, counts);
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
