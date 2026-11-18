import { PgCommon, PgExplorer } from "@/utils";

/**
 * Selects the active file's row in the tree, so the upstream `createItem`,
 * which starts a new item beside the selected row, starts it beside the file
 * being edited rather than beside a folder clicked since. With no active
 * file, or no row for it, the selection stays as it was.
 */
export const selectActiveFile = () => {
  const path = PgExplorer.currentFilePath;
  const root = PgExplorer.getRootFolderEl();
  if (!path || !root) return;
  for (const el of root.getElementsByTagName("div")) {
    const elPath = PgExplorer.getItemPathFromEl(el);
    if (elPath && PgCommon.isPathsEqual(elPath, path)) {
      PgExplorer.setSelectedEl(el);
      return;
    }
  }
};
