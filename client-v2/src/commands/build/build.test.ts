// The `build` command's refusal of an empty program file (Spec 09): it
// names the file and sends nothing. A file of its own, since it mocks the
// utils barrel the command reaches the explorer and the server through.
import { beforeEach, describe, expect, it, vi } from "vitest";

const utils = vi.hoisted(() => ({
  PgExplorer: {
    getFileContent: vi.fn<(path: string) => string | undefined>(),
    files: {},
    getCurrentSrcPath: () => "/p/src/",
  },
  PgGlobal: { update: vi.fn() },
  PgProgramInfo: { update: vi.fn(), getPkStr: () => "Pk11111111111111" },
  PgServer: { build: vi.fn() },
  PgTerminal: { println: vi.fn(), info: (text: string) => text },
  PgSettings: { build: { flags: {} } },
}));
vi.mock("../../utils", () => utils);
vi.mock("../../views/sidebar/assistant/bridge/build-output", () => ({
  PgBuildOutput: { set: vi.fn() },
}));

const { build } = await import("./build");

/** Runs the command's handler as the command manager would */
const run = () => (build.handle as () => Promise<unknown>)();

describe("commands/build/build", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["empty", ""],
    ["only whitespace", " \n\n\t"],
  ])("sends nothing when lib.rs is %s", async (_, content) => {
    utils.PgExplorer.getFileContent.mockReturnValue(content);

    await expect(run()).rejects.toMatchObject({
      message:
        "lib.rs is empty. Write a program, or ask the assistant for one.",
      emptyFile: "src/lib.rs",
    });
    expect(utils.PgExplorer.getFileContent).toHaveBeenCalledWith("src/lib.rs");
    expect(utils.PgServer.build).not.toHaveBeenCalled();
    expect(utils.PgGlobal.update).not.toHaveBeenCalled();
    // Deploy reads it, and must not go on with the old binary
    expect(utils.PgProgramInfo.update).toHaveBeenCalledWith({
      lastBuildFailed: true,
    });
  });

  // A Python project has no lib.rs; it goes on to the build as before
  it("builds a project with no lib.rs", async () => {
    utils.PgExplorer.getFileContent.mockReturnValue(undefined);

    // No source files in the stub, so the build stops at its own check
    await expect(run()).rejects.toThrow("Couldn't find any Rust files.");
    expect(utils.PgGlobal.update).toHaveBeenCalledWith({ buildLoading: true });
  });
});
