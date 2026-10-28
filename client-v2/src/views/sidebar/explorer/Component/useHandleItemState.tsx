import { RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { PgExplorer } from "../../../../utils";
import { usePgTheme } from "@/shared/lib/hooks/use-pg-theme";
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
  const theme = usePgTheme();

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

  // Whether the open file's folders still wait to be opened.
  // `PgExplorer.switchWorkspace` announces the file and the switch before
  // React draws the new project's tree, and on a loaded machine that drawing
  // outlasts any fixed wait, so the folders open once the file is in the
  // tree. The path is read when they open, from the explorer, so a file closed
  // meanwhile is never shown again.
  const reveal = useRef<"owed" | "settled">("settled");

  const revealOpenFile = (opts: { keepCtxSelected: boolean }) => {
    if (reveal.current === "settled") return;
    const path = PgExplorer.currentFilePath;
    if (!path) {
      reveal.current = "settled";
      return;
    }
    if (!PgExplorer.getElFromPath(path)) return;
    reveal.current = "settled";
    openParentsAndSelectEl(path, opts);
  };

  // Every render: the tree this component draws may be the one the file
  // waits for. That can be renders after the open, and a context menu the
  // user opened since is theirs, so its selection is kept.
  useLayoutEffect(() => revealOpenFile({ keepCtxSelected: true }));

  useEffect(() => {
    const switchWorkspace = PgExplorer.onDidSwitchWorkspace(() => {
      // Reset folder open/closed state, then open the way to the file the
      // switch opened, which it announced first
      PgExplorer.collapseAllFolders();
      reveal.current = "owed";
      revealOpenFile({ keepCtxSelected: true });
    });

    const switchFile = PgExplorer.onDidOpenFile((file) => {
      reveal.current = file ? "owed" : "settled";
      revealOpenFile({ keepCtxSelected: false });
    });

    return () => {
      switchWorkspace.dispose();
      switchFile.dispose();
    };

    //eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.name]);
};

/** Opens the folders above `path` and selects its element */
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
