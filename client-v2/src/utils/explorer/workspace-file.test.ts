import { PgCommon } from "../common";
import {
  initLogger,
  memoryProvider,
  resetLogger,
} from "../../shared/lib/logger";
import { PgExplorer } from "./explorer";
import { forgetFlushed, writeWorkspaceFile } from "./workspace-file";

/** An error shaped like lightning-fs's, with its code */
const fsError = (code: string) => Object.assign(new Error(code), { code });
const enoent = () => fsError("ENOENT");

/** Records the filesystem calls `writeWorkspaceFile` makes, in order */
const recordFs = () => {
  const calls: string[] = [];
  const write = vi
    .spyOn(PgExplorer.fs, "writeFile")
    .mockImplementation(async (path) => {
      calls.push(`write ${path}`);
    });
  const createDir = vi
    .spyOn(PgExplorer.fs, "createDir")
    .mockImplementation(async (path) => {
      calls.push(`mkdir ${path}`);
    });
  const flush = vi
    .spyOn(PgExplorer.fs, "flush")
    .mockImplementation(async () => {
      calls.push("flush");
    });
  return { calls, write, createDir, flush };
};

// The set of flushed paths lives for the module, so each test writes paths
// of its own
describe("writeWorkspaceFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes the folder tree after the first write of a path only", async () => {
    const { calls } = recordFs();

    await writeWorkspaceFile("/once/.workspace/a.json", "1");
    await writeWorkspaceFile("/once/.workspace/a.json", "2");
    await writeWorkspaceFile("/once/.workspace/b.json", "3");

    expect(calls).toEqual([
      "write /once/.workspace/a.json",
      "flush",
      "write /once/.workspace/a.json",
      "write /once/.workspace/b.json",
      "flush",
    ]);
  });

  it("creates only the missing folder, then writes", async () => {
    const { calls, write, createDir } = recordFs();
    write.mockRejectedValueOnce(enoent());

    await writeWorkspaceFile("/fresh/.workspace/a.json", "1");

    expect(createDir).toHaveBeenCalledWith("/fresh/.workspace/");
    // No `createParents`: the workspace's root is never brought back
    expect(createDir.mock.calls[0]).toHaveLength(1);
    expect(calls).toEqual([
      "mkdir /fresh/.workspace/",
      "write /fresh/.workspace/a.json",
      "flush",
    ]);
  });

  it("treats a folder another first write just made as made", async () => {
    const { calls, write, createDir } = recordFs();
    write.mockRejectedValueOnce(enoent());
    createDir.mockRejectedValueOnce(fsError("EEXIST"));

    await writeWorkspaceFile("/race/.workspace/a.json", "1");

    expect(calls).toEqual(["write /race/.workspace/a.json", "flush"]);
  });

  it("fails without writing when the workspace's folder is gone", async () => {
    const { calls, write, createDir } = recordFs();
    write.mockRejectedValueOnce(enoent());
    createDir.mockRejectedValueOnce(enoent());

    await expect(
      writeWorkspaceFile("/deleted/.workspace/a.json", "1")
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain("flush");
  });

  it("fails without making a folder for a file at a gone workspace's root", async () => {
    const { calls, write, createDir } = recordFs();
    write.mockRejectedValueOnce(enoent());

    await expect(
      writeWorkspaceFile("/rootless/.tutorial.json", "1")
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(createDir).not.toHaveBeenCalled();
    expect(calls).not.toContain("flush");
  });

  it("rethrows a failure other than a missing folder", async () => {
    const { write, createDir } = recordFs();
    write.mockRejectedValueOnce(new Error("quota exceeded"));

    await expect(
      writeWorkspaceFile("/full/.workspace/a.json", "1")
    ).rejects.toThrow("quota exceeded");
    expect(createDir).not.toHaveBeenCalled();
  });

  it("reports a failed flush without failing the write, and flushes again next time", async () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    try {
      const { calls, flush } = recordFs();
      flush.mockRejectedValueOnce(new Error("quota exceeded"));

      await writeWorkspaceFile("/flaky/.workspace/a.json", "1");
      await writeWorkspaceFile("/flaky/.workspace/a.json", "2");

      expect(logged.entries).toHaveLength(1);
      expect(logged.entries[0].ns).toBe("explorer:workspace-file");
      expect(logged.entries[0].report).toBe(true);
      expect(calls).toEqual([
        "write /flaky/.workspace/a.json",
        "write /flaky/.workspace/a.json",
        "flush",
      ]);
    } finally {
      resetLogger();
    }
  });

  it("flushes again once its folder is forgotten, and only under it", async () => {
    const { calls } = recordFs();
    await writeWorkspaceFile("/forgot/.workspace/a.json", "1");
    await writeWorkspaceFile("/kept/.workspace/a.json", "1");

    forgetFlushed("/forgot/");
    await writeWorkspaceFile("/forgot/.workspace/a.json", "2");
    await writeWorkspaceFile("/kept/.workspace/a.json", "2");

    expect(calls.filter((call) => call === "flush")).toHaveLength(3);
    expect(calls.slice(-3)).toEqual([
      "write /forgot/.workspace/a.json",
      "flush",
      "write /kept/.workspace/a.json",
    ]);
  });

  // The listeners are installed by the first write, which each case below
  // makes before it fires the event
  const changes: [string, string][] = [
    ["created", PgExplorer.events.ON_DID_CREATE_WORKSPACE],
    ["deleted", PgExplorer.events.ON_DID_DELETE_WORKSPACE],
    ["renamed", PgExplorer.events.ON_DID_RENAME_WORKSPACE],
  ];
  for (const [change, event] of changes) {
    it(`flushes again after a workspace is ${change}, since a name can come back`, async () => {
      const { calls } = recordFs();
      const path = `/${change}/.workspace/a.json`;

      await writeWorkspaceFile(path, "1");
      PgCommon.createAndDispatchCustomEvent(event);
      await writeWorkspaceFile(path, "2");

      expect(calls.filter((call) => call === "flush")).toHaveLength(2);
    });
  }
});
