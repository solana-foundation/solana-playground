import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";
import type { StageStatus } from "../state/stage";

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
 * `buildStartedAt` is the discriminator: a build this session started sets
 * it, so a missing report there means the run produced none, which is a
 * different story with its own surface.
 */
export const isRestoredBuild = (
  settled: StageStatus,
  own: BuildOutput | null,
  buildStartedAt: number | null
) =>
  own === null &&
  buildStartedAt === null &&
  (settled === "done" || settled === "failed");

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

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

    it("is false once this session has started a build of its own", () => {
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
}
