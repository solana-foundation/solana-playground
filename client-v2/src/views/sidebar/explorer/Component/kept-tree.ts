import { PgView } from "../../../../utils";

/**
 * Which folders were open when the tree last unmounted, and in which
 * project. Whether a folder is open lives only in the DOM (`PgExplorer`
 * toggles a class), so a tree that unmounts -- the files column hidden by ⌘E
 * or the stage bar, or the navigation's Sheet closed below 768 px -- comes
 * back with every folder shut unless this puts them back (design.md, "Frame
 * chrome (5.25)"). The project is `PgExplorer.currentWorkspaceId`; the
 * memory is overwritten by the next unmount, so a switch away and back still
 * finds it. Folder paths carry the project's name, so after a rename they
 * match nothing and the tree comes back shut.
 */
let kept: { workspace: string; folders: string[] } | null = null;

/** The `data-path` of every open folder under `root` */
export const openFolderPaths = (root: Element): string[] =>
  Array.from(
    root.querySelectorAll(
      `.${PgView.classNames.FOLDER}.${PgView.classNames.OPEN}`
    ),
    (el) => el.getAttribute("data-path")
  ).filter((path): path is string => !!path);

/**
 * Remembers the open folders of `root`, the tree of `workspace`; nothing with
 * no project open
 */
export const keepTree = (workspace: string | undefined, root: Element) => {
  if (workspace) kept = { workspace, folders: openFolderPaths(root) };
};

/**
 * The folders kept for `workspace`; none with no project open or when the
 * memory is another project's
 */
export const keptFolders = (workspace: string | undefined): string[] =>
  workspace && kept?.workspace === workspace ? kept.folders : [];

/** Drops the memory; for tests */
export const forgetTree = () => {
  kept = null;
};

/**
 * Opens each folder in `paths` that is still in the tree. A folder deleted
 * or renamed while the tree was away is simply not there to open.
 */
export const reopenFolders = (
  paths: string[],
  find: (path: string) => HTMLDivElement | undefined,
  open: (el: HTMLDivElement) => void
) => {
  for (const path of paths) {
    const el = find(path);
    if (el) open(el);
  }
};
