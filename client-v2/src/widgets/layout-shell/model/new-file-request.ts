import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import type { Disposable } from "@/utils/types";
import { PgView } from "@/utils/view";

import { selectActiveFile } from "./active-file";

/**
 * Whether a new file was asked for and the tree has not started it yet. The
 * tree may not be drawn when the request comes (a folded column, a closed
 * dropdown, a phone's Files page), so the request waits here for it rather
 * than the asker guessing how long the drawing takes.
 */
let pending = false;
const trees = new Set<() => void>();

/**
 * Starts a new file in the Files tree, beside the active file: asks the
 * layout to show the tree (`PgView.showFiles`) and leaves the request for
 * the tree, which runs it once it is drawn (`onNewFileRequest`), or at once
 * when it already is. Used by the editor head's + and the empty editor's
 * Add a file.
 */
export const requestNewFile = () => {
  pending = true;
  PgView.showFiles();
  trees.forEach((run) => run());
};

/**
 * For the drawn tree: runs `create` (`useCreateItem`) for a request left
 * before the tree was drawn, and for each later one, until disposed. A
 * request runs once, however many trees listen.
 *
 * @param create the tree's own New file flow
 * @returns a disposable to stop listening
 */
export const onNewFileRequest = (create: () => Promise<void>): Disposable => {
  const run = () => {
    if (!pending) return;
    pending = false;
    // `createItem` starts beside the tree's selected row, which can be a
    // folder picked since; the new file goes beside the active file
    selectActiveFile();
    create().catch(reportButtonFailure("start a new file"));
  };
  run();
  trees.add(run);
  return { dispose: () => trees.delete(run) };
};
