import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";
import type { BuildFailure, FlowState, StageStatus } from "../state/stage";

/**
 * The build report this workspace may show, or `null`.
 *
 * `PgBuildOutput` holds one value for the whole session, so it outlives the
 * project that produced it: opening a second project left the first one's
 * report on screen, announcing a build the new workspace never had. The
 * stepper reads the workspace's own record and was right; only the surface
 * was not.
 *
 * Output recorded before the tag existed counts as someone else's - it cannot
 * be attributed, and claiming it for the current workspace is the very bug.
 */
export const ownOutput = (
  out: BuildOutput | null,
  workspace: string | null
): BuildOutput | null =>
  out && workspace && out.workspace === workspace ? out : null;

/**
 * Whether the surface is showing a build the workspace remembers but this
 * page never watched.
 *
 * `PgProgramInfo.lastBuildFailed` survives a reload; the compiler's output
 * does not. Without this the surface offered a first build over a verdict
 * that says one already happened, and for a restored failure it went further
 * and named a cause ("failed before the compiler ran") it cannot know.
 *
 * `buildMs` is the discriminator: only `build-finish` sets it, and a reload
 * does not restore it, so it stays `null` until a build settles in this
 * session. `buildStartedAt` would not do: a rebuild sets it the moment it
 * starts, and the restored failure then read as "the server could not be
 * reached" for as long as the rebuild ran.
 */
export const isRestoredBuild = (
  settled: StageStatus,
  own: BuildOutput | null,
  buildMs: number | null
) =>
  own === null &&
  buildMs === null &&
  (settled === "done" || settled === "failed");

/** Which of the Build stage's surfaces is on screen */
export type BuildSurface =
  | { kind: "restored"; failed: boolean }
  /** `failure` is why the run never reached the compiler, when known */
  | { kind: "unreached"; failure: BuildFailure | null }
  | { kind: "empty" }
  | { kind: "succeeded" }
  | { kind: "failed"; stderr: string };

/**
 * The Build stage's surface for a flow state and this workspace's report.
 *
 * The surface is chosen by the last *settled* status, never by "running": an
 * unreachable build server fails in milliseconds, and swapping surfaces for
 * that round trip reads as a blink (failed -> building -> failed). While a
 * run is in flight the previous surface stays put and only its action shows
 * "Building...".
 */
export const buildSurface = ({
  flow,
  own,
}: {
  flow: Pick<
    FlowState,
    "build" | "buildSettled" | "buildStartedAt" | "buildMs" | "buildFailure"
  >;
  own: BuildOutput | null;
}): BuildSurface => {
  const settled = flow.build === "running" ? flow.buildSettled : flow.build;

  // `own` only fills in once a build reaches the compiler and returns; a
  // build that fails before that (e.g. the build server is unreachable)
  // still flips the status to "failed", but `own` stays `null` or, if a
  // previous run left one behind, goes stale.
  const stale =
    own !== null &&
    flow.buildStartedAt !== null &&
    own.at < flow.buildStartedAt;

  // The workspace's own record outlived the page; the compiler's words did
  // not. Say what is known and no more: the other surfaces would either
  // offer a first build over a finished one, or blame a build server for a
  // failure whose cause this page never saw.
  if (isRestoredBuild(settled, own, flow.buildMs)) {
    return { kind: "restored", failed: settled === "failed" };
  }
  if (settled === "failed" && (!own || stale)) {
    return { kind: "unreached", failure: flow.buildFailure };
  }
  // Also reached while the very first build is in flight: there is no
  // previous surface to hold onto, so the empty state says "Building...".
  if (!own) return { kind: "empty" };
  if (!own.failed) return { kind: "succeeded" };
  return { kind: "failed", stderr: own.stderr };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/stages/build-surface", () => {
    const outputFrom = (workspace: string | null): BuildOutput => ({
      stderr: "",
      failed: false,
      at: 1000,
      workspace,
    });

    describe("ownOutput", () => {
      it("keeps output recorded by the workspace on screen", () => {
        const out = outputFrom("proj-a");
        expect(ownOutput(out, "proj-a")).toBe(out);
      });

      /**
       * `PgBuildOutput` is one session-wide value, so switching project leaves the
       * previous project's report behind it. Shown, it claims a build the new
       * workspace never had.
       */
      it("drops output recorded by a different workspace", () => {
        expect(ownOutput(outputFrom("proj-a"), "proj-b")).toBeNull();
      });

      it("drops output that predates workspace tagging", () => {
        expect(ownOutput(outputFrom(null), "proj-a")).toBeNull();
      });

      it("has nothing to keep when no build has run", () => {
        expect(ownOutput(null, "proj-a")).toBeNull();
      });
    });

    describe("isRestoredBuild", () => {
      /**
       * A reload keeps the workspace's verdict but not the compiler's words, so
       * the surface must say the build happened without pretending to a report it
       * does not have.
       */
      it("is true for a verdict read back with no report behind it", () => {
        expect(isRestoredBuild("done", null, null)).toBe(true);
        expect(isRestoredBuild("failed", null, null)).toBe(true);
      });

      it("is false once a build has settled in this session", () => {
        expect(isRestoredBuild("done", null, 1000)).toBe(false);
      });

      it("is false while the report is on hand", () => {
        const out: BuildOutput = {
          stderr: "",
          failed: false,
          at: 1,
          workspace: "proj-a",
        };
        expect(isRestoredBuild("done", out, null)).toBe(false);
      });

      it("is false for a workspace with no verdict to restore", () => {
        expect(isRestoredBuild("upcoming", null, null)).toBe(false);
      });
    });

    /** `buildMs` is set once a build settles in this session */
    const flowOf = (
      build: StageStatus,
      buildSettled: StageStatus,
      buildStartedAt: number | null,
      buildMs: number | null = buildStartedAt === null ? null : 100
    ) => ({
      build,
      buildSettled,
      buildStartedAt,
      buildMs,
      buildFailure: NO_ANSWER,
    });

    const NO_ANSWER = {
      kind: "no-answer",
      message: "Failed to fetch",
    } as const;

    const report = (failed: boolean, at: number): BuildOutput => ({
      stderr: failed ? "error[E0308]: mismatched types" : "",
      failed,
      at,
      workspace: "proj-a",
    });

    describe("buildSurface", () => {
      it("is empty before any build", () => {
        expect(
          buildSurface({ flow: flowOf("active", "active", null), own: null })
        ).toEqual({ kind: "empty" });
      });

      it("stays empty while the first build runs", () => {
        expect(
          buildSurface({ flow: flowOf("running", "active", 5), own: null })
        ).toEqual({ kind: "empty" });
      });

      it("restores a verdict the page never watched", () => {
        expect(
          buildSurface({ flow: flowOf("failed", "failed", null), own: null })
        ).toEqual({ kind: "restored", failed: true });
        expect(
          buildSurface({ flow: flowOf("done", "done", null), own: null })
        ).toEqual({ kind: "restored", failed: false });
      });

      it("blames the server when a run left no report", () => {
        expect(
          buildSurface({ flow: flowOf("failed", "failed", 5), own: null })
        ).toEqual({ kind: "unreached", failure: NO_ANSWER });
      });

      /** A report from an earlier run is not this run's verdict */
      it("blames the server when the report predates the run", () => {
        expect(
          buildSurface({
            flow: flowOf("failed", "failed", 5),
            own: report(false, 1),
          })
        ).toEqual({ kind: "unreached", failure: NO_ANSWER });
      });

      /** Swapping surfaces for the round trip of a run reads as a blink */
      it("keeps the previous surface while a run is in flight", () => {
        expect(
          buildSurface({
            flow: flowOf("running", "done", 5),
            own: report(false, 9),
          })
        ).toEqual({ kind: "succeeded" });
      });

      it("shows a failed report", () => {
        expect(
          buildSurface({
            flow: flowOf("failed", "failed", 5),
            own: report(true, 9),
          })
        ).toEqual({ kind: "failed", stderr: "error[E0308]: mismatched types" });
      });

      /**
       * A rebuild after a reload: nothing this session has settled yet, so the
       * page still knows only the recorded verdict, not why it failed.
       */
      it("keeps a restored failure while its rebuild runs", () => {
        expect(
          buildSurface({
            flow: {
              build: "running",
              buildSettled: "failed",
              buildStartedAt: 5,
              buildMs: null,
              buildFailure: null,
            },
            own: null,
          })
        ).toEqual({ kind: "restored", failed: true });
      });
    });
  });
}
