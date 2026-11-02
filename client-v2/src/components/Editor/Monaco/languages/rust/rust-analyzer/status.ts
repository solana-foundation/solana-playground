import { createLogger } from "@/shared/lib/logger";
import type { Disposable } from "../../../../../../utils";

/**
 * Where the Rust analyzer's start is, for the status indicator. Set only by
 * `trackStart`; "taking longer" is the reader's call, from `since`.
 */
export type AnalyzerState =
  /** No Rust file has started it yet */
  | { kind: "idle" }
  /** The worker and the default crates are loading, since `Date.now()` */
  | { kind: "starting"; since: number }
  | { kind: "ready" }
  /** The start threw */
  | { kind: "failed" }
  /** The page is not cross-origin isolated, so it never starts here */
  | { kind: "off" };

type Listener = (state: AnalyzerState) => void;

let current: AnalyzerState = { kind: "idle" };
const listeners = new Set<Listener>();

export const PgAnalyzerStatus = {
  get: (): AnalyzerState => current,

  set(state: AnalyzerState) {
    current = state;
    for (const cb of listeners) cb(state);
  },

  /** Calls `cb` with the state now, then on every change */
  onDidChange(cb: Listener): Disposable {
    listeners.add(cb);
    cb(current);
    return { dispose: () => listeners.delete(cb) };
  },
};

const log = createLogger("rust-analyzer:start");

/**
 * Runs the analyzer's start under the state the indicator reads: `off` where
 * the page cannot run it, `starting` while `start` runs, then `ready`, or
 * `failed` with the error logged and rethrown
 *
 * @param isolated `window.crossOriginIsolated`, which the worker needs
 */
export const trackStart = async (
  isolated: boolean,
  start: () => Promise<Disposable>
): Promise<Disposable> => {
  if (!isolated) {
    PgAnalyzerStatus.set({ kind: "off" });
    return { dispose: () => {} };
  }
  PgAnalyzerStatus.set({ kind: "starting", since: Date.now() });
  let started: Disposable;
  try {
    started = await start();
  } catch (e) {
    // Reported here: `Monaco`'s language init rethrows it from a listener
    // nobody awaits, which reaches no error tracking
    log.error(e instanceof Error ? e : new Error(String(e)), {
      report: true,
      context: { what: "start the Rust analyzer" },
    });
    PgAnalyzerStatus.set({ kind: "failed" });
    throw e;
  }
  // Outside the `try`: a subscriber that throws is not a failed start
  PgAnalyzerStatus.set({ kind: "ready" });
  return started;
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("components/Editor/Monaco/languages/rust/rust-analyzer/status", () => {
    afterEach(() => PgAnalyzerStatus.set({ kind: "idle" }));

    it("starts idle", () => {
      expect(PgAnalyzerStatus.get()).toEqual({ kind: "idle" });
    });

    it("tells a subscriber the state now, then each change", () => {
      const cb = vi.fn();
      const { dispose } = PgAnalyzerStatus.onDidChange(cb);
      PgAnalyzerStatus.set({ kind: "starting", since: 5 });
      PgAnalyzerStatus.set({ kind: "ready" });
      dispose();
      expect(cb.mock.calls).toEqual([
        [{ kind: "idle" }],
        [{ kind: "starting", since: 5 }],
        [{ kind: "ready" }],
      ]);
    });

    it("is off, and never starts, where the page is not isolated", async () => {
      const start = vi.fn();
      await trackStart(false, start);
      expect(start).not.toHaveBeenCalled();
      expect(PgAnalyzerStatus.get()).toEqual({ kind: "off" });
    });

    it("is starting while the start runs, then ready", async () => {
      const seen: AnalyzerState["kind"][] = [];
      const { dispose } = PgAnalyzerStatus.onDidChange((s) =>
        seen.push(s.kind)
      );
      const started = { dispose: vi.fn() };
      expect(await trackStart(true, async () => started)).toBe(started);
      dispose();
      expect(seen).toEqual(["idle", "starting", "ready"]);
    });

    it("is failed when the start throws, and rethrows", async () => {
      const boom = new Error("worker");
      await expect(trackStart(true, () => Promise.reject(boom))).rejects.toBe(
        boom
      );
      expect(PgAnalyzerStatus.get()).toEqual({ kind: "failed" });
    });

    it("stops telling a disposed subscriber", () => {
      const cb = vi.fn();
      PgAnalyzerStatus.onDidChange(cb).dispose();
      PgAnalyzerStatus.set({ kind: "failed" });
      expect(cb).toHaveBeenCalledTimes(1);
      expect(PgAnalyzerStatus.get()).toEqual({ kind: "failed" });
    });
  });
}
