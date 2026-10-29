// The `build` command's refusal of an empty program file (Spec 09): it
// names the file and sends nothing; and its stop, which keeps nothing. A file of its own, since it mocks the
// utils barrel the command reaches the explorer and the server through.
import { beforeEach, describe, expect, it, vi } from "vitest";

const utils = vi.hoisted(() => ({
  PgExplorer: {
    getFileContent: vi.fn<(path: string) => string | undefined>(),
    files: {} as Record<string, { content: string }>,
    getCurrentSrcPath: () => "/p/src/",
    getRelativePath: (path: string) => path.slice("/p/".length),
    PATHS: { ROOT_DIR_PATH: "/" },
  },
  PgCommon: { joinPaths: (...paths: string[]) => paths.join("") },
  PgLanguage: { getFromPath: () => ({ name: "Rust" }) },
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
const { PgBuildOutput } = await import(
  "../../views/sidebar/assistant/bridge/build-output"
);
const { isStopped } = await import("../../utils/stopped");

/** Runs the command's handler as the command manager would */
const run = (signal = new AbortController().signal) =>
  (build.handle as (input: { signal: AbortSignal }) => Promise<unknown>)({
    signal,
  });

const PROGRAM = "use anchor_lang::prelude::*;";

describe("commands/build/build", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    utils.PgExplorer.files = {};
  });

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

  describe("stopped", () => {
    beforeEach(() => {
      utils.PgExplorer.getFileContent.mockReturnValue(PROGRAM);
      utils.PgExplorer.files = { "/p/src/lib.rs": { content: PROGRAM } };
    });

    // Spec 13: a stop aborts the request and nothing about the project moves
    it("aborts the request and keeps the project as it was", async () => {
      const stop = new AbortController();
      utils.PgServer.build.mockImplementation(
        (_req: unknown, opts: { signal: AbortSignal }) =>
          new Promise((_, rej) =>
            opts.signal.addEventListener("abort", () =>
              rej(new Error("Server request failed: aborted"))
            )
          )
      );

      const built = run(stop.signal);
      await vi.waitFor(() => expect(utils.PgServer.build).toHaveBeenCalled());
      stop.abort();
      const err = await built.catch((e: unknown) => e);

      expect(isStopped(err)).toBe(true);
      expect((err as Error).message).toBe("Stopped.");
      expect(utils.PgProgramInfo.update).not.toHaveBeenCalled();
      expect(PgBuildOutput.set).not.toHaveBeenCalled();
      expect(utils.PgGlobal.update).toHaveBeenLastCalledWith({
        buildLoading: false,
      });
    });

    it("drops a reply that arrives after the stop", async () => {
      const stop = new AbortController();
      utils.PgServer.build.mockImplementation(async () => {
        stop.abort();
        return { stderr: "Finished release", uuid: "u", idl: null };
      });

      const err = await run(stop.signal).catch((e: unknown) => e);

      expect(isStopped(err)).toBe(true);
      expect(utils.PgProgramInfo.update).not.toHaveBeenCalled();
      expect(PgBuildOutput.set).not.toHaveBeenCalled();
    });

    it("still fails a request that fails without a stop", async () => {
      utils.PgServer.build.mockRejectedValue(
        new Error("Server request failed")
      );

      const err = await run().catch((e: unknown) => e);

      expect(isStopped(err)).toBe(false);
      expect((err as Error).message).toBe("Server request failed");
    });
  });
});
