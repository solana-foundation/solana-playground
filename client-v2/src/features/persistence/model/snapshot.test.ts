import {
  buildSnapshot,
  filterSnapshotPaths,
  SYNCED_WORKSPACE_FILES,
} from "./snapshot";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgFs } from "../../../utils/explorer/fs";

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

describe("buildSnapshot", () => {
  const store = (PgFs as unknown as { __files: Map<string, string> }).__files;

  beforeEach(() => {
    store.clear();
    jest
      .spyOn(PgExplorer, "currentWorkspaceName", "get")
      .mockReturnValue("alpha");
    jest
      .spyOn(PgExplorer, "getAllFiles")
      .mockReturnValue([["/alpha/src/lib.rs", "declare_id!();"]]);
  });

  afterEach(() => jest.restoreAllMocks());

  it("stores paths relative to the project root", async () => {
    expect((await buildSnapshot()).files).toEqual({
      "src/lib.rs": "declare_id!();",
    });
  });

  it("carries the program keypair, so the project keeps its address", async () => {
    // The explorer's in-memory tree leaves dotfiles out entirely
    // (`isItemNameValid`), which is why this has to come off the store
    store.set("/alpha/.workspace/program-info.json", '{"kp":[1,2,3]}');

    expect((await buildSnapshot()).files).toEqual({
      "src/lib.rs": "declare_id!();",
      ".workspace/program-info.json": '{"kp":[1,2,3]}',
    });
  });

  it("carries tutorial progress, so a lesson resumes where it was left", async () => {
    store.set("/alpha/.tutorial.json", '{"pageNumber":3,"completed":false}');
    store.set("/alpha/.workspace/tutorial-storage.json", '{"answered":true}');

    const { files } = await buildSnapshot();

    expect(files[".tutorial.json"]).toBe('{"pageNumber":3,"completed":false}');
    expect(files[".workspace/tutorial-storage.json"]).toBe('{"answered":true}');
  });

  it("leaves out a workspace file that is not there", async () => {
    expect(Object.keys((await buildSnapshot()).files)).toEqual(["src/lib.rs"]);
  });

  it("does not carry the editor's tabs and cursors", async () => {
    store.set(
      "/alpha/.workspace/metadata.json",
      '{"tabs":["/alpha/src/lib.rs"]}'
    );

    expect((await buildSnapshot()).files[".workspace/metadata.json"]).toBe(
      undefined
    );
  });
});
