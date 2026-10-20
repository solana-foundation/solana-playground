import { RefObject, useEffect, useLayoutEffect } from "react";
import { useTheme } from "styled-components";
import { PgCommon, PgExplorer } from "../../../../utils";
import { keepTree, keptFolders, reopenFolders } from "./kept-tree";

/**
 * Manage the item state when the current workspace or file changes, and
 * across an unmount of the tree.
 *
 * @param rootRef the tree's root element (`#root-dir`)
 */
export const useHandleItemState = (
  rootRef: RefObject<HTMLDivElement | null>
) => {
  const theme = useTheme();

  // The folders open when the tree last unmounted are opened again. A layout
  // effect, so they are open before the column restores its scroll
  // (`LeftPanel`, a parent, runs its layout effects after this one) and
  // before the first paint shows them shut.
  useLayoutEffect(() => {
    // Captured now, the element this mount drew: what the cleanup keeps
    const root = rootRef.current;
    reopenFolders(
      keptFolders(PgExplorer.currentWorkspaceId),
      (path) => PgExplorer.getElFromPath(path),
      (el) => PgExplorer.openFolder(el)
    );
    return () => {
      // Read now, not at mount, as `LeftPanel` does: the project may have
      // opened after the tree mounted
      if (root) keepTree(PgExplorer.currentWorkspaceId, root);
    };
  }, [rootRef]);

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
