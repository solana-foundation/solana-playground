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
import { createLogger } from "@/shared/lib/logger";
import { isMissing } from "@/shared/lib/is-missing";

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
