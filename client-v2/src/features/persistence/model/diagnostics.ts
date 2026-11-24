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
 * when data the user created failed to be stored, retrieved or synced. The
 * one exception is a request whose connection dropped (`isNetworkFailure`):
 * it is recorded and warned of, never reported, since the next push, pull or
 * reconcile asks again, and each one reached Sentry as noise
 * (SOLANA-PLAYGROUND-E). An `AbortError` is still reported: here it is as
 * likely an aborted IndexedDB write, or a timeout of ours on an engine that
 * drops the signal's reason, as a request the browser let go.
 *
 * While diagnosing, the whole list is one command away in the browser console:
 *
 *   __pgSyncDiagnostics.failures()
 */
import { isNetworkFailure } from "@/shared/lib/ai";
import { isMissing } from "@/shared/lib/is-missing";
import { createLogger } from "@/shared/lib/logger";

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
  const context = { what: `${what} failed` };
  if (isNetworkFailure(error)) {
    log.warn(`${what} failed: the connection dropped`, { context });
    return;
  }
  log.error(error, { report: true, context });
};

/** Shared with entities that read the same filesystem (`useTutorialProgress`) */
export { isMissing };

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

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll, beforeEach, afterEach } = import.meta
    .vitest;
  describe("features/persistence/model/diagnostics", () => {
    let initLogger: typeof import("@/shared/lib/logger").initLogger;
    let memoryProvider: typeof import("@/shared/lib/logger").memoryProvider;
    let resetLogger: typeof import("@/shared/lib/logger").resetLogger;
    beforeAll(async () => {
      ({ initLogger, memoryProvider, resetLogger } = await import(
        "@/shared/lib/logger"
      ));
    });
    let logged: ReturnType<typeof memoryProvider>;

    beforeEach(() => {
      clearFailures();
      logged = memoryProvider();
      initLogger({ providers: [logged] });
    });

    afterEach(() => resetLogger());

    it("records a failure and hands back the newest one", () => {
      const error = new Error("disk full");
      report("write thread", error);

      expect(getLastFailure()).toMatchObject({ what: "write thread", error });
      expect(getFailures()).toHaveLength(1);
    });

    it("should report a failure to error tracking under its namespace", () => {
      const error = new Error("disk full");
      report("write thread", error);

      expect(logged.entries).toEqual([
        expect.objectContaining({
          ns: "persistence:diagnostics",
          level: "error",
          error,
          report: true,
          context: { what: "write thread failed" },
        }),
      ]);
    });

    it.each([
      // Safari's and Chrome's dropped connection (Sentry SOLANA-PLAYGROUND-E)
      new TypeError("Load failed"),
      new TypeError("Failed to fetch"),
    ])("records, but does not report, a request that got %s", (error) => {
      report("pull thread", error);

      expect(getLastFailure()).toMatchObject({ what: "pull thread", error });
      expect(logged.entries).toEqual([
        expect.objectContaining({
          ns: "persistence:diagnostics",
          level: "warn",
          context: { what: "pull thread failed" },
        }),
      ]);
      expect(logged.entries.some((e) => e.report)).toBe(false);
    });

    it.each([
      // A bug that is also a TypeError
      new TypeError("x.fetch is not a function"),
      // A request of ours that ran out of its time limit
      new DOMException("signal timed out", "TimeoutError"),
      // An aborted IndexedDB write, or a timeout where fetch drops the reason
      new DOMException("aborted", "AbortError"),
    ])("still reports %s", (error) => {
      report("write thread", error);

      expect(logged.entries).toEqual([
        expect.objectContaining({ level: "error", report: true }),
      ]);
    });

    it("keeps the list bounded so a failing loop cannot grow it forever", () => {
      for (let i = 0; i < 25; i++) report(`attempt ${i}`, null);

      expect(getFailures()).toHaveLength(20);
      expect(getFailures()[0].what).toBe("attempt 5");
    });

    it("tells a missing file apart from a real fault", () => {
      expect(isMissing({ code: "ENOENT" })).toBe(true);
      expect(isMissing(new Error("ENOENT: no such file"))).toBe(true);
      expect(isMissing(new Error("quota exceeded"))).toBe(false);
      expect(isMissing(undefined)).toBe(false);
    });
  });
}
