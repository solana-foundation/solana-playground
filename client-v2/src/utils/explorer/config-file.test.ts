import {
  removeConfigDir,
  removeConfigFile,
  renameConfigFile,
  writeConfigFile,
} from "./config-file";
import { PgFs } from "./fs";

const mock = PgFs as unknown as {
  __files: Map<string, string>;
  __reloadBeforeTreeSave: () => void;
};

describe("writeConfigFile", () => {
  beforeEach(() => mock.__files.clear());

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flushes the folder tree when the write creates the file", async () => {
    const flush = vi.spyOn(PgFs, "flush");

    await writeConfigFile("/.config/a.json", "1");
    mock.__reloadBeforeTreeSave();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(mock.__files.get("/.config/a.json")).toBe("1");
  });

  it("does not flush when the file already exists", async () => {
    await writeConfigFile("/.config/b.json", "1");
    const flush = vi.spyOn(PgFs, "flush");

    await writeConfigFile("/.config/b.json", "2");

    expect(flush).not.toHaveBeenCalled();
    expect(mock.__files.get("/.config/b.json")).toBe("2");
  });

  it("flushes again for a file created again after its removal", async () => {
    await writeConfigFile("/.config/c.json", "1");
    await PgFs.removeFile("/.config/c.json");
    const flush = vi.spyOn(PgFs, "flush");

    await writeConfigFile("/.config/c.json", "2");

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("keeps the write when the flush fails", async () => {
    vi.spyOn(PgFs, "flush").mockRejectedValueOnce(new Error("quota"));

    await expect(
      writeConfigFile("/.config/d.json", "1")
    ).resolves.toBeUndefined();
    expect(mock.__files.get("/.config/d.json")).toBe("1");
  });

  it("writes and flushes when it cannot tell whether the file exists", async () => {
    vi.spyOn(PgFs, "exists").mockRejectedValueOnce(new Error("idb closed"));
    const flush = vi.spyOn(PgFs, "flush");

    await writeConfigFile("/.config/e.json", "1");

    expect(mock.__files.get("/.config/e.json")).toBe("1");
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("flushes after a rename, so the new name survives a reload", async () => {
    await writeConfigFile("/.config/f.json", "1");
    const flush = vi.spyOn(PgFs, "flush");

    await renameConfigFile("/.config/f.json", "/.config/g.json");
    mock.__reloadBeforeTreeSave();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(mock.__files.get("/.config/g.json")).toBe("1");
  });

  it("flushes after a removal, so the file stays gone after a reload", async () => {
    await writeConfigFile("/.config/h.json", "1");
    const flush = vi.spyOn(PgFs, "flush");

    await removeConfigFile("/.config/h.json");
    mock.__reloadBeforeTreeSave();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(await PgFs.exists("/.config/h.json")).toBe(false);
  });

  it("flushes after a folder removal, so nothing in it comes back", async () => {
    await writeConfigFile("/.config/dir/i.json", "1");
    const flush = vi.spyOn(PgFs, "flush");

    await removeConfigDir("/.config/dir");
    mock.__reloadBeforeTreeSave();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(await PgFs.exists("/.config/dir")).toBe(false);
  });

  it("saves nothing when the removal fails", async () => {
    vi.spyOn(PgFs, "removeFile").mockRejectedValueOnce(new Error("ENOENT"));
    const flush = vi.spyOn(PgFs, "flush");

    await expect(removeConfigFile("/.config/j.json")).rejects.toThrow("ENOENT");
    expect(flush).not.toHaveBeenCalled();
  });

  it("saves the tree when a folder removal fails halfway", async () => {
    vi.spyOn(PgFs, "removeDir").mockRejectedValueOnce(new Error("idb closed"));
    const flush = vi.spyOn(PgFs, "flush");

    await expect(removeConfigDir("/.config/k")).rejects.toThrow("idb closed");
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
