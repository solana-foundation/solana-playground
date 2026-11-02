import type { Workspace } from "./ports";
import { applyFile } from "../../../utils/explorer/apply-file";
import { PgExplorer } from "../../../utils/explorer/explorer";

/** The workspace moved before the port could act: the effect is dropped */
export class WorkspaceMovedError extends Error {
  constructor(expected: string, actual: string | undefined) {
    super(`The workspace is ${actual ?? "none"}, not ${expected}`);
    this.name = "WorkspaceMovedError";
  }
}

/** Throws unless `workspace` is the open one, in the same tick as the check */
const expectOpen = (workspace: string) => {
  const current = PgExplorer.currentWorkspaceName;
  if (current !== workspace) throw new WorkspaceMovedError(workspace, current);
};

/**
 * The open workspace as the engine's `Workspace` port. The paths resolve
 * against the open workspace, so each call first checks it is the one the
 * effect was queued for, synchronously, right before resolving. A write
 * goes through `applyFile`, so the open editor shows it at once and its
 * autosave does not put the old text back.
 */
export const realWorkspace: Workspace = {
  async read(path, workspace) {
    expectOpen(workspace);
    return (
      PgExplorer.getFileContent(PgExplorer.convertToFullPath(path)) ?? null
    );
  },
  async write(path, content, workspace) {
    expectOpen(workspace);
    await applyFile(path, content);
  },
  async remove(path, workspace) {
    expectOpen(workspace);
    const fullPath = PgExplorer.convertToFullPath(path);
    if (PgExplorer.getFileContent(fullPath) === undefined) return;
    await PgExplorer.deleteItem(fullPath);
  },
};
