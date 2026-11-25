/**
 * The gate every Vercel Cron route opens with: Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` with a `GET`, and nothing else may run
 * the job.
 */
import { timingSafeEqual } from "node:crypto";

import { cronEnv } from "../../../shared/config/server-env.mjs";
import { createServerLogger } from "../../../shared/lib/logger/server.mjs";

/** @param {import("node:http").ServerResponse} res */
const sendJsonFor = (res) => (status, body) => {
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
 * Answer a request the cron route of `job` must not run for, and say whether
 * it answered: `503` while `CRON_SECRET` is unset, `405` for a method other
 * than `GET`, `401` without the secret. The secret is checked first, so any
 * request to a deployment without it answers `503`.
 *
 * @param {string} job the job's name, as its messages and its log namespace
 *   (`api:<job>`) carry it
 */
export const refuseCronFor = (job) => {
  const log = createServerLogger(`api:${job}`);
  /**
   * @param {{ method?: string; headers: Record<string, string | undefined> }} req
   * @param {import("node:http").ServerResponse} res
   * @returns {boolean} whether the request was refused and answered
   */
  return (req, res) => {
    const { CRON_SECRET } = cronEnv();
    if (!CRON_SECRET) {
      // Reported: with no secret the job never runs, and nothing else says so
      log.error(new Error(`CRON_SECRET is unset; ${job} did not run`), {
        report: true,
      });
      sendJsonFor(res)(503, { error: `The ${job} job is not configured` });
      return true;
    }
    if (req.method !== "GET") {
      res.setHeader("allow", "GET");
      sendJsonFor(res)(405, { error: "Use GET." });
      return true;
    }
    if (!isBearer(req.headers.authorization, CRON_SECRET)) {
      // Not reported: anyone can call the route. A run of these in the log
      // beside no "<job> ran" means Vercel Cron holds an old secret
      log.warn(`${job} refused a request without the cron secret`);
      sendJsonFor(res)(401, { error: "Unauthorized" });
      return true;
    }
    return false;
  };
};
