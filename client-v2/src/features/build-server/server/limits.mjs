/**
 * How many builds one signed-in user may have (HOO-2907): at most
 * `MAX_RUNNING_BUILDS` running and `MAX_BUILDS_PER_HOUR` started in the last
 * hour, counted from the user's `build_audit` rows, which
 * `build_audit_user_at_idx` covers. One account can then no longer keep every
 * build slot busy. Past either limit the route answers `429` with
 * `Retry-After`, writes no row and sends nothing to the build server.
 *
 * The count and the insert that follows are two statements, so two builds
 * that arrive in the same few milliseconds can both pass. The limit is a
 * fairness bound, not a security one, and a lock around both would need a
 * transaction the route's `query` does not offer.
 *
 * Every statement runs on a `query` the route passes in.
 */

/**
 * TODO(HOO-2907): confirm in grooming. One running build per user keeps a
 * second tab or a script from taking a second slot.
 */
export const MAX_RUNNING_BUILDS = 1;

/**
 * TODO(HOO-2907): confirm in grooming. A person iterating by hand stays well
 * under 20 builds an hour.
 */
export const MAX_BUILDS_PER_HOUR = 20;

/** The window `MAX_BUILDS_PER_HOUR` counts over */
export const BUILD_WINDOW_SECONDS = 60 * 60;

/**
 * How long a row with no `status`, or with `CALLER_LEFT`, still counts as a
 * running build: the function's `maxDuration` in `vercel.json` for
 * `api/build-server.mjs`, which the build server's `REQUEST_TIME_LIMIT` fits
 * inside. A function that died leaves `status` null for good, so a row older
 * than this is not a running build. `limits.test.mjs` fails when the two
 * differ.
 */
export const BUILD_MAX_DURATION_SECONDS = 300;

/**
 * What a user at the running limit is told to wait at most: the build ahead
 * may end any second, so the full duration would turn a short wait away
 * for minutes.
 */
export const RUNNING_RETRY_AFTER_SECONDS = 15;

/**
 * What the audit records for a build whose caller left before the answer.
 * The build server keeps compiling it and holds its slot until the build
 * process ends, so such a row still counts as running: a user who stops a
 * build and starts another must not take a second slot.
 */
export const CALLER_LEFT = 499;

/**
 * @typedef {(text: string, params?: unknown[]) => Promise<{ rows: any[] }>} Query
 */

/**
 * @typedef {{
 *   running: number;
 *   lastHour: number;
 *   runningFreesInSeconds: number | undefined;
 *   hourFreesInSeconds: number | undefined;
 * }} BuildCounts
 */

/**
 * @typedef {{ ok: true }
 *   | { ok: false; limit: "running" | "hourly"; retryAfterSeconds: number }
 * } BuildVerdict
 */

/** `pg` hands back `bigint` counts and `numeric` seconds as strings */
const numberOrUndefined = (value) =>
  value === null || value === undefined ? undefined : Number(value);

/**
 * Count the user's running builds and the builds started in the last hour,
 * with when each count next drops.
 *
 * @param {Query} query
 * @returns {(userId: string) => Promise<BuildCounts>}
 */
export const countBuildsWith = (query) => async (userId) => {
  const { rows } = await query(
    `select
       count(*) filter (where (status is null or status = $4)
                          and at > now() - make_interval(secs => $2::double precision))
         as running,
       count(*) as last_hour,
       extract(epoch from (
         min(at) filter (where (status is null or status = $4)
                           and at > now() - make_interval(secs => $2::double precision))
         + make_interval(secs => $2::double precision) - now()))
         as running_frees_in,
       extract(epoch from (
         min(at) + make_interval(secs => $3::double precision) - now()))
         as hour_frees_in
     from build_audit
     where user_id = $1
       and at > now() - make_interval(secs => $3::double precision)`,
    [userId, BUILD_MAX_DURATION_SECONDS, BUILD_WINDOW_SECONDS, CALLER_LEFT]
  );
  const row = rows[0] ?? {};
  return {
    running: Number(row.running ?? 0),
    lastHour: Number(row.last_hour ?? 0),
    runningFreesInSeconds: numberOrUndefined(row.running_frees_in),
    hourFreesInSeconds: numberOrUndefined(row.hour_frees_in),
  };
};

/** A wait in whole seconds, at least one: `Retry-After` takes no fraction */
const wholeSeconds = (seconds) => Math.max(1, Math.ceil(seconds));

/**
 * Whether a build may start, and when to ask again if not. With both limits
 * hit, the longer wait is the answer: asking at the shorter one is refused
 * again, and the limit that lasts longer is the one named.
 *
 * @param {BuildCounts} counts
 * @returns {BuildVerdict}
 */
export const judgeBuild = (counts) => {
  const isRunningFull = counts.running >= MAX_RUNNING_BUILDS;
  const isHourFull = counts.lastHour >= MAX_BUILDS_PER_HOUR;
  if (!isRunningFull && !isHourFull) return { ok: true };

  const runningWait = Math.min(
    counts.runningFreesInSeconds ?? RUNNING_RETRY_AFTER_SECONDS,
    RUNNING_RETRY_AFTER_SECONDS
  );
  const hourWait = counts.hourFreesInSeconds ?? BUILD_WINDOW_SECONDS;
  if (isRunningFull && !isHourFull) {
    return {
      ok: false,
      limit: "running",
      retryAfterSeconds: wholeSeconds(runningWait),
    };
  }
  return {
    ok: false,
    limit: "hourly",
    retryAfterSeconds: wholeSeconds(
      isRunningFull ? Math.max(runningWait, hourWait) : hourWait
    ),
  };
};

/**
 * Count, then judge. Throws when the count cannot be read, and the route
 * refuses the build then, as it does when the audit row cannot be written.
 *
 * @param {Query} query
 * @returns {(userId: string) => Promise<BuildVerdict>}
 */
export const checkBuildLimitWith = (query) => async (userId) =>
  judgeBuild(await countBuildsWith(query)(userId));
