/**
 * Where persistence failures go instead of being swallowed.
 *
 * Everything in this slice catches: a lost write must not take the panel down,
 * and an unreachable server must not stop the app working offline. The cost is
 * that a real fault and an empty conversation used to look identical -- both
 * produced an empty thread and complete silence.
 *
 * So failures are recorded here and reported through the logger at `error`,
 * which reaches the console and error tracking in production too: this fires
 * when data the user created failed to be stored, retrieved or synced.
 *
 * While diagnosing, the whole list is one command away in the browser console:
 *
 *   __pgSyncDiagnostics.failures()
 */
import { createLogger } from "../../../shared/lib/logger";

const log = createLogger("persistence:diagnostics");

export interface Failure {
  what: string;
  error: unknown;
  at: string;
}

/** Enough to see a pattern, bounded so a failing loop cannot grow forever */
const MAX = 20;

const failures: Failure[] = [];

export const report = (what: string, error: unknown) => {
  failures.push({ what, error, at: new Date().toISOString() });
  if (failures.length > MAX) failures.shift();
  log.error(error, { report: true, context: { what: `${what} failed` } });
};

/**
 * Whether an error just means "no such file" -- usually the expected case,
 * and not worth a report. Same matching as `sync-mark` and `chat-storage`:
 * the browser filesystem says it as a code and in the message.
 */
export const isMissing = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  return e?.code === "ENOENT" || !!e?.message?.includes("ENOENT");
};

export const getFailures = (): readonly Failure[] => [...failures];

export const getLastFailure = (): Failure | null =>
  failures.length ? failures[failures.length - 1] : null;

export const clearFailures = () => {
  failures.length = 0;
};

// Development only, like the assistant store's own hook: `craco build` sets
// NODE_ENV to production, so this is dropped from the shipped bundle.
if (process.env.NODE_ENV !== "production") {
  (window as unknown as { __pgSyncDiagnostics?: unknown }).__pgSyncDiagnostics =
    { failures: getFailures, last: getLastFailure, clear: clearFailures };
}
