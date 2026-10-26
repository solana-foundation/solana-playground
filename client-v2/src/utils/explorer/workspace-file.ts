import { PgExplorer } from "./explorer";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("explorer:workspace-file");

/**
 * Full paths `writeWorkspaceFile` has flushed, since the page loaded or since
 * a workspace was last created, deleted or renamed.
 *
 * Emptied when a workspace's name goes away (delete, rename) as well as when
 * one is created: a name that comes back holds new files, and the creating
 * switch can write them before the create event fires.
 */
const flushed = new Set<string>();
let clearsOnChange = false;

/** Whether `e` is a filesystem error with the given code */
const hasCode = (e: unknown, code: string) =>
  e instanceof Error && "code" in e && e.code === code;

/**
 * Write a file the current workspace keeps beside its code (under
 * `.workspace/`), so that it survives a reload.
 *
 * lightning-fs writes a file's content at once but saves its folder tree
 * 500 ms after the last write, so a reload inside that window loses a file
 * just created. `PgFs.flush` saves the tree, but it rewrites the whole tree
 * every time, so it runs only on a path's first write since `flushed` was
 * last emptied: that write may be the one that creates the file, and later
 * ones only change content.
 *
 * A missing folder is created on its own, never its parents. A workspace that
 * was deleted or renamed while the write waited has no root, so the write
 * fails instead of bringing its folder back with stale files in it.
 *
 * A failed flush is reported here and does not fail the write: the content
 * landed, only its survival of a reload in the next 500 ms is at risk, and
 * the next write of the path tries the flush again.
 *
 * @param path path relative to the current workspace, or a full path
 * @param data file content
 */
export const writeWorkspaceFile = async (path: string, data: string) => {
  if (!clearsOnChange) {
    const clear = () => flushed.clear();
    PgExplorer.onDidCreateWorkspace(clear);
    PgExplorer.onDidDeleteWorkspace(clear);
    PgExplorer.onDidRenameWorkspace(clear);
    clearsOnChange = true;
  }

  // Resolved once, so a switch while this waits cannot move the write
  const fullPath = PgExplorer.convertToFullPath(path);
  try {
    await PgExplorer.fs.writeFile(fullPath, data);
  } catch (e) {
    if (!hasCode(e, "ENOENT")) throw e;
    try {
      await PgExplorer.fs.createDir(PgExplorer.getParentPathFromPath(fullPath));
    } catch (mkdirError) {
      // Another first write made the folder in the meantime
      if (!hasCode(mkdirError, "EEXIST")) throw mkdirError;
    }
    await PgExplorer.fs.writeFile(fullPath, data);
  }

  if (flushed.has(fullPath)) return;
  try {
    await PgExplorer.fs.flush();
    flushed.add(fullPath);
  } catch (e) {
    log.error(e, { report: true });
  }
};
