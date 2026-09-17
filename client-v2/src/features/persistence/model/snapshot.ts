// Deep import, not the `utils` barrel: the barrel reaches `settings.ts`,
// which reads a webpack-defined global that does not exist under jest, so
// importing it here would make this module untestable. Same reason
// `chat-storage.ts` reaches for `utils/explorer/fs` directly.
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgFs } from "../../../utils/explorer/fs";

/**
 * Workspace files that travel with the code.
 *
 * `program-info.json` carries the program keypair. Syncing it is deliberate:
 * without it the same project deploys to a different address on every device,
 * which is the thing users notice. This is a playground, the keys are
 * playground keys, and the UI says so. The two tutorial files are what let a
 * lesson resume on another device at the page it was left on, rather than at
 * the beginning.
 *
 * `.workspace/metadata.json` -- the open tabs and cursor positions -- is
 * deliberately *not* here. It is rewritten every time a project is opened, so
 * syncing it would make merely looking at a project a change the other device
 * has to reconcile, and two idle browsers would trade conflicts over where the
 * caret was.
 */
export const SYNCED_WORKSPACE_FILES = [
  ".workspace/program-info.json",
  ".workspace/tutorial-storage.json",
  ".tutorial.json",
];

/** Keep user files and the named workspace files; drop everything else */
export const filterSnapshotPaths = (paths: readonly string[]) =>
  paths.filter(
    (path) =>
      SYNCED_WORKSPACE_FILES.includes(path) || !path.startsWith(".workspace/")
  );

/** One project, as it is stored */
export interface Snapshot {
  files: Record<string, string>;
}

/**
 * Serialize the current workspace.
 *
 * Paths are stored relative to the project root, not absolute: the absolute
 * form embeds the workspace name, so a renamed or differently-named project on
 * another device would not match.
 */
export const buildSnapshot = async (): Promise<Snapshot> => {
  const tuples = PgExplorer.getAllFiles();
  const prefix = `/${PgExplorer.currentWorkspaceName}/`;
  const files: Record<string, string> = {};

  for (const [fullPath, content] of tuples) {
    const path = fullPath.startsWith(prefix)
      ? fullPath.slice(prefix.length)
      : fullPath.replace(/^\//, "");
    files[path] = content;
  }

  // Read off the store rather than the explorer, because the explorer does not
  // have them: `isItemNameValid` rejects any name starting with a dot, so
  // nothing under `.workspace/` -- nor `.tutorial.json` -- is ever in the
  // in-memory tree. Filtering for them alone therefore filtered a set they
  // were never in, and the program keypair and tutorial progress silently
  // stayed on whichever device made them.
  for (const path of SYNCED_WORKSPACE_FILES) {
    try {
      files[path] = await PgFs.readToString(prefix + path);
    } catch {
      // A project that has never been built has no keypair, and one that is
      // not a tutorial has no progress. Absent is the common case, not a fault.
    }
  }

  const kept = filterSnapshotPaths(Object.keys(files));
  return {
    files: Object.fromEntries(kept.map((path) => [path, files[path]])),
  };
};

/** Cheap change detection, so an unchanged workspace is not re-uploaded */
export const hashSnapshot = (snapshot: Snapshot) => {
  const text = JSON.stringify(snapshot);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return `${text.length}:${hash}`;
};
