import { uuid } from "../../shared/lib/ids";
import { report } from "../../features/persistence/model/diagnostics";
import { reloadCurrentFromDisk } from "../../features/persistence/model/tab-reload";
import { PgFs } from "../../utils/explorer/fs";
// Deep import rather than the `utils` barrel, for the reason
// `project-sync.tsx` gives
import { PgExplorer } from "../../utils/explorer/explorer";
import { PgWorkspace } from "../../utils/explorer/workspace";
import type { Disposable } from "../../utils/types";

const CHANNEL = "pg-workspace-sync";

/** Long enough that a run of autosaves is one message */
const ANNOUNCE_MS = 250;
/** Long enough that a run of messages is one reload */
const RELOAD_MS = 300;
/**
 * How long a reload that came back `deferred` waits to ask again: past the
 * editor's autosave, so typing has reached the store by then
 */
const DEFERRED_MS = 1000;
/**
 * How many times it asks before leaving it to the next message or focus.
 * Bounded so a tab typed in without pause cannot keep reloading for ever,
 * and long enough to outlast a burst of typing.
 */
const DEFERRED_TRIES = 30;

interface FilesWritten {
  type: "files-written";
  projectId: string;
  from: string;
}

const isFilesWritten = (data: unknown): data is FilesWritten =>
  (data as FilesWritten)?.type === "files-written" &&
  typeof (data as FilesWritten).projectId === "string";

/** The list of workspaces changed: one was created, deleted or renamed */
interface WorkspacesWritten {
  type: "workspaces-written";
  from: string;
}

const isWorkspacesWritten = (data: unknown): data is WorkspacesWritten =>
  (data as WorkspacesWritten)?.type === "workspaces-written";

/**
 * Which project a written path belongs to, if it is worth announcing.
 *
 * Not only the current one: an import, or an adopt of a project in the
 * background, writes elsewhere -- and the neighbour may have that one open.
 * `metadata.json` is the one file left out. It holds this tab's open tabs and
 * cursor, it is rewritten on every open, and no other tab has any use for it.
 */
const projectOfPath = (path: string): string | null => {
  const name = path.split("/")[1];
  if (!name || !PgExplorer.allWorkspaceNames?.includes(name)) return null;
  if (path === `/${name}/.workspace/metadata.json`) return null;
  return PgExplorer.workspaceIdOf(name) ?? null;
};

/**
 * Keep tabs of one browser from working on each other's old copies.
 *
 * Tabs share the store but not each other's memory, so a tab showing a
 * project another tab has written goes on showing the old text -- and the
 * next autosave in it writes the old text back, file by file, before sync is
 * ever involved. Visibility cannot catch it: two windows side by side are
 * both visible the whole time. So each tab says when it has written, and a
 * tab that has the same project open re-reads it.
 *
 * Deliberately independent of the session. The overwrite on disk needs no
 * account, and neither does the fix.
 *
 * Where the browser has no `BroadcastChannel` this does nothing; the reload
 * at the start of every reconcile still catches up on focus.
 */
export const tabSync = (): Disposable => {
  if (typeof BroadcastChannel !== "function") return { dispose: () => {} };

  const channel = new BroadcastChannel(CHANNEL);
  const self = uuid();

  const pending = new Set<string>();
  let workspacesPending = false;
  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    for (const id of pending) {
      const message: FilesWritten = {
        type: "files-written",
        projectId: id,
        from: self,
      };
      channel.postMessage(message);
    }
    pending.clear();
    if (workspacesPending) {
      const message: WorkspacesWritten = {
        type: "workspaces-written",
        from: self,
      };
      channel.postMessage(message);
      workspacesPending = false;
    }
  };
  const schedule = () => {
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(flush, ANNOUNCE_MS);
  };
  const announce = (projectId: string | null | undefined) => {
    if (!projectId) return;
    pending.add(projectId);
    schedule();
  };

  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let tries = 0;
  const reloadIn = (ms: number) => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, ms);
  };
  // A reload that is `deferred` is still owed: the neighbour's write that
  // asked for it is on disk, and this tab goes on showing the old copy --
  // and autosaving it -- until something reloads again. Nothing else would,
  // short of another message or the tab losing and regaining focus.
  const reload = () => {
    reloadCurrentFromDisk()
      .then((result) => {
        if (result !== "deferred" || disposed || tries >= DEFERRED_TRIES) {
          tries = 0;
          return;
        }
        tries++;
        reloadIn(DEFERRED_MS);
      })
      .catch((e) => report("reload from tab", e));
  };

  channel.onmessage = ({ data }) => {
    if (isWorkspacesWritten(data)) {
      if (data.from === self) return;
    } else if (isFilesWritten(data)) {
      if (data.from === self) return;
      if (data.projectId !== PgExplorer.currentWorkspaceId) return;
    } else return;

    // One timer for both kinds, so a delete -- which announces the files and
    // then the list -- is one reload. A changed list needs nothing more: the
    // reload re-reads it first, inside its own queue, so no other reload can
    // be half-way through when it changes.
    tries = 0;
    reloadIn(RELOAD_MS);
  };

  // Writes cover edits and the three dotfiles. Deletes and renames reach the
  // store without a write, so the tree's own events cover those. Both carry
  // a full path -- the deleted one, and the *old* one for a rename -- and an
  // item is only ever renamed within its workspace, so either names the
  // project that changed, which is not always the one open by the time the
  // event is heard.
  //
  // The list of workspaces is written on every create, delete, rename and
  // switch. A neighbour holding an old copy would save it back over the
  // change on its next switch, so it has to hear of this one.
  const onPath = (path: string) => {
    if (path === PgWorkspace.WORKSPACES_CONFIG_PATH) {
      workspacesPending = true;
      schedule();
    } else announce(projectOfPath(path));
  };
  const subscriptions = [
    PgFs.onDidWriteFile(onPath),
    PgExplorer.onDidDeleteItem(onPath),
    PgExplorer.onDidRenameItem(onPath),
  ];

  return {
    dispose: () => {
      disposed = true;
      if (announceTimer) clearTimeout(announceTimer);
      if (reloadTimer) clearTimeout(reloadTimer);
      for (const sub of subscriptions) sub.dispose();
      channel.close();
    },
  };
};
