/**
 * The conversation's pace, as data. The reducer stamps every scripted turn
 * with an `at`; the store schedules a re-render at each `at` still ahead,
 * and the view shows a turn once its `at` has come. Nothing here owns a
 * timer.
 */

/**
 * The reading pace: the prototype's queue posts one turn per tick, so each
 * scripted turn arrives this long after the one before it. One constant,
 * tuned once the feed renders it (task 3.3).
 */
export const TICK_MS = 700;

/** The finish card follows the last win by this much (spec: 400 ms) */
export const FINISH_DELAY_MS = 400;
