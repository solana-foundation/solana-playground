import { useEffect } from "react";
import { useTheme } from "styled-components";
import { PgCommon, PgExplorer } from "../../../../utils";

/** Manage the item state when the current workspace or file changes. */
export const useHandleItemState = () => {
  const theme = useTheme();

  useEffect(() => {
    const switchWorkspace = PgExplorer.onDidSwitchWorkspace(() => {
      // Reset folder open/closed state
      PgExplorer.collapseAllFolders();
    });

    const openParentsAndSelectEl = (
      path: string,
      { keepCtxSelected }: { keepCtxSelected: boolean }
    ) => {
      // Open if current file's parents are not opened
      PgExplorer.openAllParents(path);

      // Change selected element
      const newEl = PgExplorer.getElFromPath(path);
      if (newEl) {
        PgExplorer.setSelectedEl(newEl);
        if (!keepCtxSelected) PgExplorer.removeCtxSelectedEl();
      }
    };

    const switchFile = PgExplorer.onDidOpenFile(async (file) => {
      if (!file) return;

      openParentsAndSelectEl(file.path, { keepCtxSelected: false });

      // Sleep before opening parents because switching workspace collapses
      // all folders after file switching. The context selection is left
      // alone: one made since belongs to a menu the user opened in those
      // 300 ms, and the tree mounts again each time the project Sheet opens
      // below 768 px, so clearing it here left that menu's Rename and Delete
      // with nothing to act on.
      await PgCommon.sleep(300);
      openParentsAndSelectEl(file.path, { keepCtxSelected: true });
    });

    return () => {
      switchWorkspace.dispose();
      switchFile.dispose();
    };

    //eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.name]);
};
