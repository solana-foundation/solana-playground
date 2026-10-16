import { PgExplorer } from "@/utils/explorer";
import { readWorkspaceFiles, rebaseFiles } from "./workspace-files";

const reset = async () => {
  (
    PgExplorer.fs as unknown as { __files: Map<string, string> }
  ).__files.clear();
  const statics = PgExplorer as unknown as {
    _workspace: unknown;
    _initializedWorkspaceName: unknown;
  };
  statics._workspace = null;
  statics._initializedWorkspaceName = null;
  await PgExplorer.init();
};

describe("readWorkspaceFiles", () => {
  beforeEach(reset);

  it("reads a workspace's files as full paths, leaving out .workspace", async () => {
    await PgExplorer.createWorkspace("alpha", {
      files: [
        ["/alpha/src/lib.rs", "fn main() {}"],
        ["/alpha/Cargo.toml", "[package]"],
        ["/alpha/.workspace/program-info.json", '{"kp":[1]}'],
      ],
    });
    await PgExplorer.createWorkspace("beta", {
      files: [["/beta/src/lib.rs", "beta();"]],
    });

    const files = await readWorkspaceFiles("alpha", PgExplorer.fs);

    expect([...files].sort()).toEqual([
      ["/alpha/Cargo.toml", "[package]"],
      ["/alpha/src/lib.rs", "fn main() {}"],
    ]);
  });
});

describe("rebaseFiles", () => {
  it("moves files under another workspace name", () => {
    expect(
      rebaseFiles([["/alpha/src/lib.rs", "x"]], "alpha", "alpha copy")
    ).toEqual([["/alpha copy/src/lib.rs", "x"]]);
  });
});
