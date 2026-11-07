import { createLogger } from "../../shared/lib/logger";
import { PgFs } from "./fs";

const log = createLogger("explorer:config-file");

/**
 * Save the folder tree after a change to it under `/.config`.
 *
 * A failed flush is reported here and does not fail the change: the content
 * landed, and lightning-fs's own debounced save tries again, so only a reload
 * in the next 500 ms is at risk. It is logged here rather than through the
 * persistence slice's diagnostics, which this module, below the layers, cannot
 * import; `report: true` still sends it to Sentry.
 */
const flushAfter = async (change: string, path: string) => {
  try {
    await PgFs.flush();
  } catch (e) {
    log.error(e, { context: { path, change }, report: true });
  }
};

/**
 * Write a file the app keeps outside any workspace, under `/.config`, so that
 * a file it creates survives a reload.
 *
 * lightning-fs writes a file's content at once but saves its folder tree
 * 500 ms after the last write, so a reload inside that window loses a file
 * just created: its content is stored, and nothing points at it. `PgFs.flush`
 * saves the tree, but it rewrites the whole tree every time, so it runs only
 * when this write creates the file; a write to a file that exists changes
 * content only. Unlike `writeWorkspaceFile`, which remembers the paths it
 * flushed, this asks whether the file exists, because the stores that use it
 * also remove their files, and a removed file's next write creates it again.
 *
 * Two first writes of one path that overlap both flush, which costs a tree
 * rewrite and loses nothing.
 *
 * @param path full path of the file
 * @param data file content
 */
export const writeConfigFile = async (path: string, data: string) => {
  // Started before the write, so the stat is queued ahead of it and sees the
  // file as it was. A check that fails cannot tell, so the write flushes.
  const existed = PgFs.exists(path).catch((e) => {
    log.warn("Could not tell whether a config file exists; saving the tree", {
      context: { path, error: e },
    });
    return false;
  });
  await PgFs.writeFile(path, data, { createParents: true });
  if (await existed) return;
  await flushAfter("creating a file", path);
};

/**
 * Rename a file under `/.config` so that the new name survives a reload.
 *
 * A rename changes only the folder tree, so a reload before lightning-fs
 * saves it brings the file back under its old name, while whatever was
 * written meanwhile to point at the new name (`PgThreadIndex`'s map) is
 * already stored. Saved right after the rename, before the caller writes
 * that pointer.
 *
 * @param from full path the file has now
 * @param to full path it moves to
 */
export const renameConfigFile = async (from: string, to: string) => {
  await PgFs.rename(from, to);
  await flushAfter("a rename", to);
};

/**
 * Remove a file under `/.config` so that it stays gone after a reload.
 *
 * lightning-fs deletes the content at once but drops the file from its folder
 * tree only when it saves the tree, so a reload before that leaves a ghost:
 * the file exists and is listed, and reads as `undefined`. A ghost sync mark
 * keeps its project out of `pushNeverSynced`. A removal that throws, a missing
 * file among them, changed nothing and saves nothing.
 *
 * @param path full path of the file
 */
export const removeConfigFile = async (path: string) => {
  await PgFs.removeFile(path);
  await flushAfter("a removal", path);
};

/**
 * Remove a folder under `/.config` and everything in it so that none of it
 * comes back after a reload, as `removeConfigFile` explains.
 *
 * Unlike a file's, a folder's removal can fail halfway, with some children
 * already unlinked, so the tree is saved whether it succeeds or throws.
 *
 * @param path full path of the folder
 */
export const removeConfigDir = async (path: string) => {
  try {
    await PgFs.removeDir(path, { recursive: true });
  } finally {
    await flushAfter("a removal", path);
  }
};
