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
 * it is recorded, warned of and counted (`sync_request_dropped`), never
 * reported, since the next push, pull or reconcile asks again, and each one
 * reached Sentry as noise (SOLANA-PLAYGROUND-E). An `AbortError` is still reported: here it is as
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

import type { DroppedOpParam } from "./telemetry";
import { DROPPED_OPS, persistenceTelemetry } from "./telemetry";

/** The first word of an operation, as `sync_request_dropped` counts it */
const opOf = (what: string): DroppedOpParam => {
  const word = what.split(" ", 1)[0];
  return DROPPED_OPS.find((op) => op === word) ?? "other";
};

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
    persistenceTelemetry.track("sync_request_dropped", { op: opOf(what) });
    return;
  }
  // A failure with no error object, such as an HTTP answer, is named by what
  // failed: logged bare, it reached Sentry as "Error: null"
  const reported =
    error === null || error === undefined ? new Error(what) : error;
  log.error(reported, { report: true, context });
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
    let telemetry: typeof import("@/shared/lib/telemetry");
    let events: ReturnType<typeof telemetry.memoryProvider>;
    beforeAll(async () => {
      telemetry = await import("@/shared/lib/telemetry");
    });

    beforeEach(() => {
      clearFailures();
      logged = memoryProvider();
      initLogger({ providers: [logged] });
      events = telemetry.memoryProvider();
      telemetry.initTelemetry({ providers: [events] });
    });

    afterEach(() => {
      resetLogger();
      telemetry.resetTelemetry();
    });

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

    // `report(what, null)` is a failure with no error object, such as an HTTP
    // answer (Sentry SOLANA-PLAYGROUND-15, -16 and -1D got "Error: null")
    // eslint-disable-next-line unicorn/no-null -- what `report`'s callers pass for no error object
    it.each([null, undefined])(
      "should report a failure that came with %s as an Error named by what failed",
      (value) => {
        report("fetch project p1: HTTP 404", value);

        const [{ error }] = logged.entries;
        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toBe("fetch project p1: HTTP 404");
        expect(getLastFailure()).toMatchObject({
          what: "fetch project p1: HTTP 404",
          error: value,
        });
      }
    );

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
      expect(events.events.map((e) => [e.name, e.params])).toEqual([
        ["sync_request_dropped", { op: "pull" }],
      ]);
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
      expect(events.events).toEqual([]);
    });

    it("counts an operation it does not list as other", () => {
      report("threads of p1", new TypeError("Load failed"));

      expect(events.events.map((e) => e.params)).toEqual([{ op: "other" }]);
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
