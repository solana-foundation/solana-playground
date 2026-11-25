/**
 * The stale-turn sweep, called by Vercel Cron: ends the assistant turns whose
 * route never settled them (`settleStaleTurns`). Bookkeeping on the ledger,
 * kept apart from the retention job, which removes personal data.
 *
 * Deliberately plain ESM using raw Node request/response APIs, like the rest
 * of `api/` -- see `api/health.mjs` for why.
 */
import { settleStaleTurns } from "../src/features/agent/server.mjs";
import {
  refuseCronFor,
  warnAboutMissingObservabilityIds,
  withObservability,
} from "../src/features/api/server.mjs";
import { query } from "../src/features/persistence/server.mjs";
import { createServerLogger } from "../src/shared/lib/logger/server.mjs";

const log = createServerLogger("api:stale-turns");

const refuse = refuseCronFor("stale-turns");

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * The route, with the sweep passed in; the default export wires the real
 * one, the tests their own.
 *
 * @param {{ sweep: () => Promise<number> }} deps
 */
export const handleWith = (deps) => async (req, res) => {
  if (refuse(req, res)) return;
  try {
    const staleTurns = await deps.sweep();
    log.info("stale-turns ran", { context: { staleTurns } });
    return sendJson(res, 200, { staleTurns });
  } catch (e) {
    log.error(new Error("stale-turns sweep failed", { cause: e }), {
      report: true,
    });
    return sendJson(res, 500, { error: "The sweep failed" });
  }
};

export default withObservability("stale-turns", (req, res) => {
  warnAboutMissingObservabilityIds();
  return handleWith({ sweep: () => settleStaleTurns(query) })(req, res);
});
