// The `build` command's refusal of an empty program file (Spec 09): it
// names the file and sends nothing; and its stop, which keeps nothing. A file of its own, since it mocks the
// utils barrel the command reaches the explorer and the server through.
import { beforeEach, describe, expect, it, vi } from "vitest";

const utils = vi.hoisted(() => ({
  PgExplorer: {
    getFileContent: vi.fn<(path: string) => string | undefined>(),
    files: {} as Record<string, { content: string }>,
    currentWorkspaceId: "id-a" as string | undefined,
    currentWorkspaceName: "a" as string | undefined,
    getCurrentSrcPath: () => "/p/src/",
    getRelativePath: (path: string) => path.slice("/p/".length),
    PATHS: { ROOT_DIR_PATH: "/" },
  },
  PgCommon: { joinPaths: (...paths: string[]) => paths.join("") },
  PgLanguage: { getFromPath: () => ({ name: "Rust" }) },
  PgGlobal: { update: vi.fn() },
  PgProgramInfo: { update: vi.fn(), getPkStr: () => "Pk11111111111111" },
  PgServer: { build: vi.fn() },
  PgTerminal: {
    println: vi.fn(),
    info: (text: string) => text,
    warning: (text: string) => text,
  },
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
const { clearBuildRefused, isBuildRefused, markBuildRefused } = await import(
  "./refused-build"
);

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
    utils.PgExplorer.currentWorkspaceId = "id-a";
    utils.PgExplorer.currentWorkspaceName = "a";
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

  // Spec 13's variants are for the terminal's own lines, not the compiler's
  it("prints the compiler's output with no variant", async () => {
    utils.PgExplorer.getFileContent.mockReturnValue(PROGRAM);
    utils.PgExplorer.files = { "/p/src/lib.rs": { content: PROGRAM } };
    utils.PgServer.build.mockResolvedValue({
      stderr: "Compiling probe v0.1.0",
      idl: undefined,
      uuid: undefined,
    });

    await run();

    const output = utils.PgTerminal.println.mock.calls.at(-1)?.[0];
    expect(output).toContain("Compiling probe");
    expect(output).not.toContain("\x1b");
  });

  // Spec client-v2-idl-build-guide: "A build without an IDL keeps the IDL the browser holds"
  describe("idl", () => {
    beforeEach(() => {
      utils.PgExplorer.getFileContent.mockReturnValue(PROGRAM);
      utils.PgExplorer.files = { "/p/src/lib.rs": { content: PROGRAM } };
    });

    it("keeps the held IDL when the build returns none", async () => {
      // eslint-disable-next-line unicorn/no-null -- the build response carries `null` for no IDL
      utils.PgServer.build.mockResolvedValue({ stderr: "", idl: null });

      await run();

      expect(utils.PgProgramInfo.update).toHaveBeenCalledTimes(1);
      expect(utils.PgProgramInfo.update.mock.calls[0][0]).not.toHaveProperty(
        "idl"
      );
    });

    it("replaces the held IDL with the one the build returns", async () => {
      const idl = {
        address: "",
        metadata: { name: "b", version: "0.1.0", spec: "0.1.0" },
        instructions: [],
      };
      utils.PgServer.build.mockResolvedValue({ stderr: "", idl });

      await run();

      expect(utils.PgProgramInfo.update).toHaveBeenCalledWith(
        expect.objectContaining({ idl })
      );
    });
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
      expect(utils.PgProgramInfo.update).toHaveBeenCalledWith({
        lastBuildFailed: true,
      });
    });
    // A refusal for sign-in never reached the compiler: the saved verdict
    // stays what it was, so a reload does not show a failed build
    it("keeps the saved verdict when the build is refused for sign-in", async () => {
      utils.PgServer.build.mockRejectedValue(
        Object.assign(new Error("Sign in with GitHub to build."), {
          reason: "signed-out",
        })
      );

      const err = await run().catch((e: unknown) => e);

      expect((err as Error).message).toBe("Sign in with GitHub to build.");
      expect(utils.PgProgramInfo.update).not.toHaveBeenCalled();
    });
    // The kept verdict may be a pass for older code, so Deploy must know the
    // current source never built
    it("marks the project when sign-in refuses its build", async () => {
      utils.PgServer.build.mockRejectedValue(
        Object.assign(new Error("Sign in with GitHub to build."), {
          reason: "signed-out",
        })
      );

      await run().catch(() => undefined);

      expect(isBuildRefused("id-a")).toBe(true);
      expect(isBuildRefused("id-b")).toBe(false);
    });

    it("clears the mark once a build reaches the compiler", async () => {
      markBuildRefused("id-a");
      utils.PgServer.build.mockResolvedValue({
        stderr: "error: could not compile `p`",
        uuid: "u",
        idl: null,
      });

      await run();

      expect(isBuildRefused("id-a")).toBe(false);
    });

    // A refusal in one project says nothing about another: building the open
    // project must not let Deploy reuse the other's binary
    it("keeps another project's mark when this one builds", async () => {
      markBuildRefused("id-b");
      utils.PgServer.build.mockResolvedValue({
        stderr: "",
        uuid: "u",
        idl: null,
      });

      await run();

      expect(isBuildRefused("id-b")).toBe(true);
      clearBuildRefused("id-b");
    });

    it("keeps another project's mark when this one fails to compile", async () => {
      markBuildRefused("id-b");
      utils.PgServer.build.mockRejectedValue(new Error("boom"));

      await run().catch(() => undefined);

      expect(isBuildRefused("id-b")).toBe(true);
      clearBuildRefused("id-b");
    });
  });

  describe("another project opened during the build", () => {
    beforeEach(() => {
      utils.PgExplorer.getFileContent.mockReturnValue(PROGRAM);
      utils.PgExplorer.files = { "/p/src/lib.rs": { content: PROGRAM } };
    });

    it.each([
      // eslint-disable-next-line unicorn/no-null -- the build response carries `null` for no IDL
      ["a reply", async () => ({ stderr: "Finished release", idl: null })],
      [
        "a failed compile",
        // eslint-disable-next-line unicorn/no-null -- the build response carries `null` for no IDL
        async () => ({ stderr: "error: could not compile `solpg`", idl: null }),
      ],
      [
        "a failure",
        async () => {
          throw new Error("Server request failed");
        },
      ],
    ])(
      "leaves that project's info alone on %s, and says its result was dropped",
      async (_, answer) => {
        utils.PgServer.build.mockImplementation(async () => {
          utils.PgExplorer.currentWorkspaceId = "id-b";
          utils.PgExplorer.currentWorkspaceName = "b";
          return answer();
        });

        await run().catch(() => undefined);

        expect(utils.PgProgramInfo.update).not.toHaveBeenCalled();
        expect(PgBuildOutput.set).not.toHaveBeenCalled();
        // Deploy's guard cannot see this verdict, so the user must hear of it
        expect(utils.PgTerminal.println).toHaveBeenCalledWith(
          expect.stringContaining('The result of building "a" was dropped')
        );
      }
    );

    it("keeps the result of a project renamed during its build", async () => {
      utils.PgServer.build.mockImplementation(async () => {
        utils.PgExplorer.currentWorkspaceName = "renamed";
        return { stderr: "", uuid: "u", idl: undefined };
      });

      await run();

      expect(utils.PgProgramInfo.update).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: "u" })
      );
      expect(PgBuildOutput.set).toHaveBeenCalledWith("", "renamed");
    });
  });
});
