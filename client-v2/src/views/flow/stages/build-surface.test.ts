import { isRestoredBuild, ownOutput } from "./build-surface";
import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";

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
