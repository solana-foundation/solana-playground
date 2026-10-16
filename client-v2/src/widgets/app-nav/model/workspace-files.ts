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
