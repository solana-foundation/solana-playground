import type { PgFs } from "@/utils/explorer/fs";
import type { TupleFiles } from "@/utils/explorer/types";

type Fs = Pick<typeof PgFs, "readDir" | "getMetadata" | "readToString">;

/**
 * A workspace's files, as full paths, read from the store rather than the
 * explorer's memory, which holds only the open workspace.
 *
 * `.workspace/` is left out: its `program-info.json` holds the program
 * keypair, and a duplicate holding it would deploy over the original's
 * program. The rest of that folder is the explorer's own state (open tabs,
 * a lesson's progress), which a new workspace makes for itself.
 */
export const readWorkspaceFiles = async (name: string, fs: Fs) => {
  const root = `/${name}`;
  const files: TupleFiles = [];

  const walk = async (dir: string) => {
    for (const item of await fs.readDir(dir)) {
      const path = `${dir}/${item}`;
      if (path === `${root}/.workspace`) continue;
      if ((await fs.getMetadata(path)).isFile()) {
        files.push([path, await fs.readToString(path)]);
      } else {
        await walk(path);
      }
    }
  };
  await walk(root);

  return files;
};

/**
 * A workspace's files keyed by path relative to its root, as a share reads
 * them; `.workspace/` is left out as {@link readWorkspaceFiles} leaves it.
 */
export const readProjectFiles = async (name: string, fs: Fs) => {
  const root = `/${name}/`;
  const files: Record<string, string> = {};
  for (const [path, content] of await readWorkspaceFiles(name, fs)) {
    files[path.slice(root.length)] = content;
  }
  return files;
};

/** The same files under another workspace's folder */
export const rebaseFiles = (
  files: TupleFiles,
  from: string,
  to: string
): TupleFiles =>
  files.map(([path, content]) => [
    `/${to}${path.slice(from.length + 1)}`,
    content,
  ]);

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach, beforeAll } = import.meta.vitest;

  describe("widgets/app-nav/model/workspace-files", () => {
    let PgExplorer: typeof import("@/utils/explorer").PgExplorer;
    beforeAll(async () => {
      ({ PgExplorer } = await import("@/utils/explorer"));
    });
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

    describe("readProjectFiles", () => {
      beforeEach(reset);

      it("keys a workspace's files by their path inside it", async () => {
        await PgExplorer.createWorkspace("alpha", {
          files: [
            ["/alpha/src/lib.rs", "fn main() {}"],
            ["/alpha/.workspace/program-info.json", '{"kp":[1]}'],
          ],
        });

        expect(await readProjectFiles("alpha", PgExplorer.fs)).toEqual({
          "src/lib.rs": "fn main() {}",
        });
      });
    });

    describe("rebaseFiles", () => {
      it("moves files under another workspace name", () => {
        expect(
          rebaseFiles([["/alpha/src/lib.rs", "x"]], "alpha", "alpha copy")
        ).toEqual([["/alpha copy/src/lib.rs", "x"]]);
      });
    });
  });
}
