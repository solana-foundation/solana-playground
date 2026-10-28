import { PgExplorer } from "../utils/explorer/explorer";
import { PgFs } from "../utils/explorer/fs";

// `setupTests.ts` replaces `PgFs` with `mockFsModule`'s, so this is the mock.
// Its signatures are checked against `PgFs` by the compiler (`satisfies` in
// `mock-fs.ts`); these cover the behaviour the compiler cannot see.

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

  it("fails a missing file with ENOENT, as PgFs.exists expects", async () => {
    await expect(PgFs.readToString("/nowhere")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(PgFs.getMetadata("/nowhere")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
