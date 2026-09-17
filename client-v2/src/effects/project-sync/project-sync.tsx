import { PgProjectSync } from "../../features/persistence/model/project-sync";
// Deep import rather than the `utils` barrel, which reaches `settings.ts` and
// a webpack-defined global jest has no answer for. Same workaround as
// `snapshot.ts`; here it is what makes this effect testable at all, and what
// this effect subscribes to is exactly what was wrong before.
import { PgExplorer } from "../../utils/explorer/explorer";
import type { Disposable } from "../../utils/types";

/** Long enough that typing is one upload, short enough to survive a crash */
const DEBOUNCE_MS = 3000;

/**
 * Mirror the current workspace to Postgres as it changes.
 *
 * An app-level effect for the same reason `chatThread` is one: the explorer
 * panel can be collapsed, and whether the user's code is backed up must not
 * depend on whether anyone is looking at the file tree.
 *
 * Trailing debounce, so a burst of keystrokes is one upload rather than one
 * per character. `PgProjectSync.push` is itself a no-op when the snapshot is
 * unchanged, signed out, or the deployment has no database, so this is cheap
 * in every case where sync is not actually in use.
 */
export const projectSync = (): Disposable => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const push = () => PgProjectSync.pushCurrent();

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void push(), DEBOUNCE_MS);
  };

  // Contents, then the shape of the tree. A rename or delete changes what the
  // snapshot should contain just as much as an edit does.
  //
  // The switch is not an edit, and is subscribed anyway: this effect mirrors
  // whichever workspace is current, so opening one is the moment it becomes
  // this effect's business. Without it a project only ever reached the server
  // by being typed in, and simply visiting one left it stranded on this
  // device. `push` is a no-op for a snapshot the server already has, so
  // switching back and forth costs nothing.
  const subscriptions = [
    PgExplorer.onDidSaveFile(schedule),
    PgExplorer.onDidCreateItem(schedule),
    PgExplorer.onDidRenameItem(schedule),
    PgExplorer.onDidDeleteItem(schedule),
    PgExplorer.onDidSwitchWorkspace(schedule),
  ];

  // A tab closed mid-debounce would otherwise lose the last few seconds of
  // work. Fired without waiting: the page is going away regardless, and a
  // pending upload is better than a guaranteed loss.
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
    void push();
  };
  window.addEventListener("beforeunload", flush);

  return {
    dispose: () => {
      if (timer) clearTimeout(timer);
      for (const sub of subscriptions) sub.dispose();
      window.removeEventListener("beforeunload", flush);
    },
  };
};
