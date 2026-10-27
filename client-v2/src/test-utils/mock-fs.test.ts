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

    expect([...files().keys()]).toEqual(["/ws/src/lib.rs"]);
    expect(await PgFs.readToString("src/lib.rs")).toBe("fn main() {}");
    expect(await PgFs.exists("/ws/src")).toBe(true);
  });

  it("removes a directory, not its namesake siblings", async () => {
    files().set("/a/b/one", "1");
    files().set("/a/bc/two", "2");

    await PgFs.removeDir("/a/b", { recursive: true });

    expect([...files().keys()]).toEqual(["/a/bc/two"]);
  });

  it("refuses to remove a directory that is not empty unless recursive", async () => {
    files().set("/a/b/one", "1");

    await expect(PgFs.removeDir("/a/b")).rejects.toThrow("ENOTEMPTY");
    expect(files().has("/a/b/one")).toBe(true);
  });
});
