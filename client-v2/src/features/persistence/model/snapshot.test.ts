import {
  buildSnapshotOf,
  diffFiles,
  filterSnapshotPaths,
  hashFiles,
  isUserFile,
  sameUserFiles,
  sha256,
  snapshotOf,
  SYNCED_WORKSPACE_FILES,
} from "./snapshot";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgFs } from "../../../utils/explorer/fs";

describe("per-file hashes", () => {
  it("hashes each file on its own", async () => {
    const hashes = await hashFiles({ files: { "a.rs": "1", "b.rs": "1" } });
    expect(Object.keys(hashes).sort()).toEqual(["a.rs", "b.rs"]);
    expect(hashes["a.rs"]).toBe(hashes["b.rs"]);
    expect(hashes["a.rs"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the SHA-256 of the UTF-8 bytes", async () => {
    // Pinned so a client and a database computing the same hash agree
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("names what changed and what went, against a base", () => {
    expect(
      diffFiles({ a: "1", b: "2", c: "3" }, { a: "1", b: "9", d: "4" })
    ).toEqual({ changed: ["b", "d"], removed: ["c"] });
  });

  it("compares only the files a user writes", () => {
    const generated = ".workspace/program-info.json";
    expect(isUserFile(generated)).toBe(false);
    expect(isUserFile("src/lib.rs")).toBe(true);
    expect(
      sameUserFiles({ a: "1", [generated]: "x" }, { a: "1", [generated]: "y" })
    ).toBe(true);
    expect(sameUserFiles({ a: "1" }, { a: "1", b: "2" })).toBe(false);
    expect(sameUserFiles({ a: "1" }, { a: "2" })).toBe(false);
  });
});

describe("filterSnapshotPaths", () => {
  it("keeps user source files", () => {
    expect(filterSnapshotPaths(["src/lib.rs", "client/client.ts"])).toEqual([
      "src/lib.rs",
      "client/client.ts",
    ]);
  });

  it("keeps the workspace files the spec names, program keypair included", () => {
    expect(filterSnapshotPaths(SYNCED_WORKSPACE_FILES)).toEqual(
      SYNCED_WORKSPACE_FILES
    );
  });

  it("drops anything else under .workspace", () => {
    expect(filterSnapshotPaths([".workspace/scratch.json"])).toEqual([]);
  });

  it("does not carry the editor's tabs and cursors between devices", () => {
    // Every open rewrites them, so syncing them would make simply looking at a
    // project a change the other device has to reconcile
    expect(filterSnapshotPaths([".workspace/metadata.json"])).toEqual([]);
  });
});

describe("buildSnapshotOf", () => {
  const store = (PgFs as unknown as { __files: Map<string, string> }).__files;

  beforeEach(() => store.clear());
  afterEach(() => vi.restoreAllMocks());

  it("reads a project the user is not looking at", async () => {
    store.set("/beta/src/lib.rs", "other project");
    store.set("/beta/client/client.ts", "console.log()");

    expect((await buildSnapshotOf("beta")).files).toEqual({
      "src/lib.rs": "other project",
      "client/client.ts": "console.log()",
    });
  });

  it("reads a workspace whose files never landed as empty, not as a failure", async () => {
    expect((await buildSnapshotOf("ghost")).files).toEqual({});
  });

  it("throws when the store fails to read, rather than reading as empty", async () => {
    // Read as empty, a store that failed would be a project with every file
    // deleted -- and that is what the next push would upload
    store.set("/beta/src/lib.rs", "code");
    vi.spyOn(PgFs, "readDir").mockRejectedValueOnce(
      new Error("QuotaExceededError")
    );

    await expect(buildSnapshotOf("beta")).rejects.toThrow("QuotaExceeded");
  });

  it("applies the same filter, so the two agree on what a project is", async () => {
    store.set("/beta/src/lib.rs", "code");
    store.set("/beta/.workspace/metadata.json", '{"tabs":[]}');
    store.set("/beta/.workspace/program-info.json", '{"kp":[1]}');

    expect(Object.keys((await buildSnapshotOf("beta")).files).sort()).toEqual([
      ".workspace/program-info.json",
      "src/lib.rs",
    ]);
  });

  it("carries tutorial progress, so a lesson resumes where it was left", async () => {
    store.set("/beta/.tutorial.json", '{"pageNumber":3,"completed":false}');
    store.set("/beta/.workspace/tutorial-storage.json", '{"answered":true}');

    const { files } = await buildSnapshotOf("beta");

    expect(files[".tutorial.json"]).toBe('{"pageNumber":3,"completed":false}');
    expect(files[".workspace/tutorial-storage.json"]).toBe('{"answered":true}');
  });
});

describe("snapshotOf", () => {
  const store = (PgFs as unknown as { __files: Map<string, string> }).__files;

  beforeEach(() => {
    store.clear();
    // The pre-fix implementation branched on this to decide whether to read
    // memory or disk for the current workspace. Left in place, mocked to
    // still say "alpha" and to still hold a different value than the store,
    // so a regression back to reading memory for the current workspace fails
    // this test rather than passing it by accident.
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(
      "alpha"
    );
    vi.spyOn(PgExplorer, "getAllFiles").mockReturnValue([
      ["/alpha/src/lib.rs", "unsaved edit"],
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("reads the current workspace off the store too", async () => {
    // Memory is per tab and disk is shared, so memory is the copy that can
    // be stale. An edit reaches disk straight after state, so nothing the
    // user typed is missing from here by the time a push runs.
    store.set("/alpha/src/lib.rs", "what is on disk");

    expect((await snapshotOf("alpha")).files["src/lib.rs"]).toBe(
      "what is on disk"
    );
  });

  it("reads any other workspace off the store", async () => {
    store.set("/beta/src/lib.rs", "on disk");

    expect((await snapshotOf("beta")).files["src/lib.rs"]).toBe("on disk");
  });
});
