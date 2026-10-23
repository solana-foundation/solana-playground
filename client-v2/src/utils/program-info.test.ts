import { PgExplorer } from "./explorer";
import { writeWorkspaceFile } from "./explorer/workspace-file";
import { initLogger, memoryProvider, resetLogger } from "../shared/lib/logger";
import { PgProgramInfo } from "./program-info";

// `settings.ts`, reached through the connection module, reads a global that
// only exists once the app has booted
vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
});

// The wasm packages are built separately and absent from a plain checkout
vi.mock("./package", () => ({ PgPackage: {} }));

// Only their change events are read, to refetch the on-chain data
vi.mock("./command", () => ({
  PgCommand: { deploy: { onDidFinish: () => ({ dispose: () => {} }) } },
}));
vi.mock("./connection", () => ({
  PgConnection: { onDidChange: () => ({ dispose: () => {} }) },
}));

// Its own tests cover when it flushes and which folders it creates
vi.mock("./explorer/workspace-file", () => ({
  writeWorkspaceFile: vi.fn(async () => {}),
}));

describe("PgProgramInfo storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves through writeWorkspaceFile, which keeps a new file across a reload", async () => {
    vi.spyOn(PgExplorer, "isInitialized", "get").mockReturnValue(true);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("w");
    vi.spyOn(PgExplorer.fs, "readToJSON").mockRejectedValue(new Error("none"));
    const write = vi.mocked(writeWorkspaceFile);

    const init = await PgProgramInfo.init();
    try {
      await PgProgramInfo.refresh();
      write.mockClear();

      PgProgramInfo.uuid = "build-1";
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    } finally {
      init.dispose();
    }

    expect(write.mock.calls[0][0]).toBe(".workspace/program-info.json");
    expect(JSON.parse(write.mock.calls[0][1]).uuid).toBe("build-1");
  });

  it("reports a write that fails rather than leaving it unhandled", async () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    vi.spyOn(PgExplorer, "isInitialized", "get").mockReturnValue(true);
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue("w");
    vi.spyOn(PgExplorer.fs, "readToJSON").mockRejectedValue(new Error("none"));
    const write = vi.mocked(writeWorkspaceFile);

    const init = await PgProgramInfo.init();
    try {
      await PgProgramInfo.refresh();
      write.mockClear();
      write.mockRejectedValueOnce(new Error("disk full"));

      // `updatable` calls `storage.write` without awaiting it, so a failure
      // must be caught and logged inside it, or it is an unhandled rejection
      PgProgramInfo.uuid = "build-1";
      await vi.waitFor(() => expect(write).toHaveBeenCalled());
      await vi.waitFor(() => expect(logged.entries).toHaveLength(1));
      expect(logged.entries[0].ns).toBe("program-info:storage");
      expect(logged.entries[0].error?.message).toBe("disk full");
      expect(logged.entries[0].report).toBe(true);
    } finally {
      init.dispose();
      resetLogger();
    }
  });
});
