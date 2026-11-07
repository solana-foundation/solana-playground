import type { Disposable } from "../../../../utils/types";

/** What `trackBuildSource` reads: the build command and the program's source */
export interface BuildSourcePort {
  onDidStart: (cb: () => void) => Disposable;
  onDidFinish: (cb: (result: { err?: unknown }) => void) => Disposable;
  /** The program's source as one comparable value, read when a build starts */
  source: () => string;
  /** Whether the build that just finished failed in the compiler */
  failed: () => boolean;
}

/** The source the last successful build compiled, and whether it still is */
export interface BuildSource extends Disposable {
  /** True only when a build passed and the source has not changed since */
  isCurrent: () => boolean;
}

/**
 * Keep the source each build started from, so a deploy can tell an edit made
 * since the last passing build. `PgProgramInfo.uuid` and `lastBuildFailed`
 * do not change when the learner edits `lib.rs`, so a deploy reading only them
 * would upload the old binary. Every build counts, the editor's included; a
 * build the page did not see (before a reload) is never current, so the next
 * deploy builds once.
 */
export const trackBuildSource = (port: BuildSourcePort): BuildSource => {
  let started: string | undefined;
  let built: string | undefined;
  const subs = [
    port.onDidStart(() => {
      started = port.source();
    }),
    port.onDidFinish((result) => {
      built = result.err || port.failed() ? undefined : started;
      started = undefined;
    }),
  ];
  return {
    isCurrent: () => built !== undefined && built === port.source(),
    dispose: () => subs.forEach((s) => s.dispose()),
  };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/build-source", () => {
    /** A port whose build events fire on demand */
    const portWith = (state: { source: string; failed: boolean }) => {
      const starts: Array<() => void> = [];
      const finishes: Array<(r: { err?: unknown }) => void> = [];
      const port: BuildSourcePort = {
        onDidStart: (cb) => {
          starts.push(cb);
          return { dispose: () => {} };
        },
        onDidFinish: (cb) => {
          finishes.push(cb);
          return { dispose: () => {} };
        },
        source: () => state.source,
        failed: () => state.failed,
      };
      const build = (result: { err?: unknown }) => {
        starts.forEach((cb) => cb());
        finishes.forEach((cb) => cb(result));
      };
      return { port, build };
    };

    it("is not current before any build", () => {
      const { port } = portWith({ source: "a", failed: false });
      expect(trackBuildSource(port).isCurrent()).toBe(false);
    });

    it("is current after a passing build of the same source", () => {
      const state = { source: "a", failed: false };
      const { port, build } = portWith(state);
      const tracked = trackBuildSource(port);
      build({});
      expect(tracked.isCurrent()).toBe(true);
    });

    it("is not current once the source changes after the build", () => {
      const state = { source: "a", failed: false };
      const { port, build } = portWith(state);
      const tracked = trackBuildSource(port);
      build({});
      state.source = "b";
      expect(tracked.isCurrent()).toBe(false);
    });

    it("is not current after a build the compiler failed", () => {
      const state = { source: "a", failed: true };
      const { port, build } = portWith(state);
      const tracked = trackBuildSource(port);
      build({});
      expect(tracked.isCurrent()).toBe(false);
    });

    it("is not current after a build that threw", () => {
      const { port, build } = portWith({ source: "a", failed: false });
      const tracked = trackBuildSource(port);
      build({ err: new Error("unreachable") });
      expect(tracked.isCurrent()).toBe(false);
    });
  });
}
