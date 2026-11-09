import { PgExplorer } from "../utils/explorer/explorer";
import { PgFs } from "../utils/explorer/fs";

// `setupTests.ts` replaces `PgFs` with `mockFsModule`'s, so this is the mock.
// Its signatures are checked against `PgFs` by the compiler (`satisfies` in
// `mock-fs.ts`); these cover the behaviour the compiler cannot see. A file of
// its own, not an in-source block: the cases drive the mock together with
// `PgExplorer`'s path resolution.

const files = () =>
  (PgFs as unknown as { __files: Map<string, string> }).__files;

beforeEach(() => files().clear());
afterEach(() => vi.restoreAllMocks());

describe("the PgFs mock", () => {
  it("resolves a path the way PgFs does", async () => {
    vi.spyOn(PgExplorer, "convertToFullPath").mockImplementation(
      (path: string) => (path.startsWith("/") ? path : `/ws/${path}`)
    );

    await PgFs.writeFile("src/lib.rs", "fn main() {}");

    expect(Array.from(files().keys())).toEqual(["/ws/src/lib.rs"]);
    expect(await PgFs.readToString("src/lib.rs")).toBe("fn main() {}");
    expect(await PgFs.exists("/ws/src")).toBe(true);
  });

  it.each([
    [
      "rename",
      async () => {
        await PgFs.rename("src", "lib");
        return Array.from(files().keys());
      },
      ["/ws/lib/main.rs"],
    ],
    ["readDir", () => PgFs.readDir("src"), ["main.rs"]],
    [
      "getMetadata",
      async () => (await PgFs.getMetadata("src")).isDirectory(),
      true,
    ],
  ])("resolves %s's paths the way PgFs does", async (_, run, expected) => {
    vi.spyOn(PgExplorer, "convertToFullPath").mockImplementation(
      (path: string) => (path.startsWith("/") ? path : `/ws/${path}`)
    );
    files().set("/ws/src/main.rs", "fn main() {}");

    expect(await run()).toEqual(expected);
  });

  it("removes a directory, not its namesake siblings", async () => {
    files().set("/a/b/one", "1");
    files().set("/a/bc/two", "2");

    await PgFs.removeDir("/a/b", { recursive: true });

    expect(Array.from(files().keys())).toEqual(["/a/bc/two"]);
  });

  it("refuses to remove a directory that is not empty unless recursive", async () => {
    files().set("/a/b/one", "1");

    await expect(PgFs.removeDir("/a/b")).rejects.toMatchObject({
      code: "ENOTEMPTY",
    });
    expect(files().has("/a/b/one")).toBe(true);
  });

  it("refuses to remove a file as a directory, with ENOTDIR", async () => {
    files().set("/a/b", "1");

    await expect(PgFs.removeDir("/a/b")).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });

  it("fails a missing file with ENOENT, as PgFs.exists expects", async () => {
    await expect(PgFs.readToString("/nowhere")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(PgFs.getMetadata("/nowhere")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  describe("a reload before the folder tree is saved", () => {
    const reloadBeforeTreeSave = () =>
      (
        PgFs as unknown as { __reloadBeforeTreeSave: () => void }
      ).__reloadBeforeTreeSave();

    // Saved, so what an earlier test left unsaved does not leak in
    beforeEach(() => PgFs.flush());

    it("loses a file created since the last flush", async () => {
      await PgFs.writeFile("/.config/new.json", "1");

      reloadBeforeTreeSave();

      expect(files().has("/.config/new.json")).toBe(false);
    });

    it("keeps a file that existed before, with its new content", async () => {
      await PgFs.writeFile("/.config/old.json", "1");
      await PgFs.flush();
      await PgFs.writeFile("/.config/old.json", "2");

      reloadBeforeTreeSave();

      expect(files().get("/.config/old.json")).toBe("2");
    });

    it("keeps a file seeded straight into the store", async () => {
      files().set("/.config/seeded.json", "1");

      reloadBeforeTreeSave();

      expect(files().get("/.config/seeded.json")).toBe("1");
    });

    it("keeps a file created before a flush", async () => {
      await PgFs.writeFile("/.config/flushed.json", "1");
      await PgFs.flush();

      reloadBeforeTreeSave();

      expect(files().get("/.config/flushed.json")).toBe("1");
    });

    it("puts a renamed file back under its old name", async () => {
      await PgFs.writeFile("/.config/a.json", "1");
      await PgFs.flush();
      await PgFs.rename("/.config/a.json", "/.config/b.json");
      await PgFs.rename("/.config/b.json", "/.config/c.json");

      reloadBeforeTreeSave();

      expect(Array.from(files().entries())).toEqual([["/.config/a.json", "1"]]);
    });

    it("leaves a ghost of a saved file removed since the last flush", async () => {
      await PgFs.writeFile("/.config/gone.json", "1");
      await PgFs.flush();
      await PgFs.removeFile("/.config/gone.json");

      reloadBeforeTreeSave();

      expect(await PgFs.exists("/.config/gone.json")).toBe(true);
      expect(await PgFs.readDir("/.config")).toEqual(["gone.json"]);
      expect(await PgFs.readToString("/.config/gone.json")).toBeUndefined();
    });

    it("leaves no ghost of a removal saved by a flush", async () => {
      await PgFs.writeFile("/.config/gone.json", "1");
      await PgFs.flush();
      await PgFs.removeDir("/.config", { recursive: true });
      await PgFs.flush();

      reloadBeforeTreeSave();

      expect(await PgFs.exists("/.config/gone.json")).toBe(false);
    });

    it("leaves no ghost of a file created and removed since the flush", async () => {
      await PgFs.writeFile("/.config/brief.json", "1");
      await PgFs.removeFile("/.config/brief.json");

      reloadBeforeTreeSave();

      expect(await PgFs.exists("/.config/brief.json")).toBe(false);
    });

    it("reads a ghost written again as a stored file", async () => {
      await PgFs.writeFile("/.config/back.json", "1");
      await PgFs.flush();
      await PgFs.removeFile("/.config/back.json");
      reloadBeforeTreeSave();

      await PgFs.writeFile("/.config/back.json", "2");
      reloadBeforeTreeSave();

      expect(await PgFs.readToString("/.config/back.json")).toBe("2");
    });

    it("loses a file created and renamed since the last flush", async () => {
      await PgFs.writeFile("/.config/a.json", "1");
      await PgFs.rename("/.config/a.json", "/.config/b.json");

      reloadBeforeTreeSave();

      expect(files().size).toBe(0);
    });
  });
});
