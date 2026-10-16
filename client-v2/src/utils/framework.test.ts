import JSZip from "jszip";

import { PgCommon } from "./common";
import { PgExplorer } from "./explorer";
import { PgFramework } from "./framework";

/**
 * `exportWorkspace` exported only the open workspace: the navigation's
 * project list exports any project from its menu, so it takes a name.
 */

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

const zipped = async (blob: Blob) => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return Object.keys(zip.files).filter((path) => !zip.files[path].dir);
};

describe("PgFramework.exportWorkspace", () => {
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());

  it("exports the named workspace while another one is open", async () => {
    await PgExplorer.createWorkspace("alpha", {
      files: [["/alpha/src/lib.rs", "alpha();"]],
    });
    await PgExplorer.createWorkspace("beta", {
      files: [["/beta/src/lib.rs", "beta();"]],
    });
    expect(PgExplorer.currentWorkspaceName).toBe("beta");
    const exported = vi.spyOn(PgCommon, "export").mockImplementation(() => {});

    await PgFramework.exportWorkspace({ name: "alpha" });

    const [fileName, blob] = exported.mock.calls[0] as [string, Blob];
    expect(fileName).toBe("alpha.zip");
    expect(await zipped(blob)).toEqual(["src/lib.rs"]);
  });

  it("refuses an empty name rather than export the open workspace", async () => {
    await PgExplorer.createWorkspace("beta", {
      files: [["/beta/src/lib.rs", "beta();"]],
    });
    const exported = vi.spyOn(PgCommon, "export").mockImplementation(() => {});

    await expect(PgFramework.exportWorkspace({ name: "" })).rejects.toThrow();
    expect(exported).not.toHaveBeenCalled();
  });

  it("exports the open workspace when no name is given", async () => {
    await PgExplorer.createWorkspace("beta", {
      files: [["/beta/src/lib.rs", "beta();"]],
    });
    const exported = vi.spyOn(PgCommon, "export").mockImplementation(() => {});

    await PgFramework.exportWorkspace();

    const [fileName, blob] = exported.mock.calls[0] as [string, Blob];
    expect(fileName).toBe("beta.zip");
    expect(await zipped(blob)).toEqual(["src/lib.rs"]);
  });
});
