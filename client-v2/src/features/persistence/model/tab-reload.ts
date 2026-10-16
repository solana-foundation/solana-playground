import { isMissing, report } from "./diagnostics";
import { PgEditorModels } from "./editor-models";
// Deep imports, not the `utils` barrel, for the reason `snapshot.ts` gives
import { PgCommon } from "../../../utils/common";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgFs } from "../../../utils/explorer/fs";
import { PgRouter } from "../../../utils/router";

/**
 * - `deferred`: not now, but the reload is still owed -- a re-open would
 *   throw away something of this tab's, or this tab's own change to the
 *   list has yet to be saved. The caller asks again.
 */
export type ReloadResult =
  | "skipped"
  | "unchanged"
  | "contents"
  | "reopened"
  | "deferred";

/**
 * Every file the explorer's in-memory tree could hold, read off the store.
 *
 * Only names `isItemNameValid` accepts: the tree never holds a dotfile, so
 * `.workspace/` and `.tutorial.json` changing -- which `PgProgramInfo` does on
 * every open -- is not a difference this tab can or should act on. That is
 * also what stops two tabs from reloading each other in a loop.
 *
 * @returns full paths to contents, or `null` when the directory is gone
 */
const readTree = async (root: string) => {
  const files: Record<string, string> = {};

  const walk = async (dir: string) => {
    for (const child of await PgFs.readDir(dir)) {
      if (!PgExplorer.isItemNameValid(child)) continue;
      const path = `${dir}/${child}`;
      if ((await PgFs.getMetadata(path)).isDirectory()) await walk(path);
      else files[path] = await PgFs.readToString(path);
    }
  };

  try {
    await walk(root);
  } catch (e) {
    // A directory that is gone is the expected case -- renamed or deleted in
    // another tab. Anything else is a store that failed to read, and a
    // reload that silently does nothing looks exactly like one that found
    // nothing to do.
    if (!isMissing(e)) report(`reload ${root}: read`, e);
    return null;
  }
  return files;
};

/** The current workspace as this tab holds it: files only, not empty dirs */
const inMemory = () => {
  const files: Record<string, string> = {};
  for (const [path, item] of Object.entries(PgExplorer.files)) {
    if (!path.endsWith("/") && item.content !== undefined) {
      files[path] = item.content;
    }
  }
  return files;
};

const sameKeys = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).sort().join("\n") === Object.keys(b).sort().join("\n");

/**
 * The workspace the in-memory tree is under, by the name it was loaded with.
 *
 * Taken from the tree rather than from the current name, because the list
 * may already have been re-read -- and after a rename or delete in another
 * tab the current name no longer says where memory holds the files. A tree
 * with no files says nothing, and the name it was opened under stands in.
 */
const memoryRoot = (): string | undefined => {
  const path = PgExplorer.currentFilePath ?? Object.keys(PgExplorer.files)[0];
  return path?.split("/")[1] || openName;
};

type Item = typeof PgExplorer.files[string];

/**
 * What this tab last had on disk for each file of the open workspace: read
 * when it was opened, taken from disk by a reload, or written by this tab.
 *
 * State that differs from it is a change of this tab's own that never
 * reached disk -- an autosave that failed. State equal to it is only old:
 * disk may have moved on since, through another tab, and that is not this
 * tab's to write back. Kept from the explorer's own events rather than read
 * off disk, which is shared, and so cannot say whose a difference is.
 *
 * A write is recorded with the data it wrote, which the event carries: by
 * the time it is heard, state may already hold a later edit, whose own write
 * has yet to land -- or never will. `PgFs` announces a write only once it
 * has landed, so a failed one leaves the old entry in place.
 *
 * Keyed by the explorer's item, not its path. A rename in this tab moves the
 * same item to the new path, so the record goes with it -- the rename event
 * names only the old path, and a record left behind there would make the
 * renamed file look like this tab's own change, to be written back over a
 * neighbour's later edit. A file created since the open is a new item, with
 * no record at all.
 */
let known = new WeakMap<Item, string>();

/** The workspace this tab last opened, by the name it had then */
let openName: string | undefined;

/**
 * And by its id, which a rename elsewhere keeps. Only this tab's own switch
 * changes the current id without the tree having been re-read yet.
 *
 * `null` for a temporary project, which was opened from no workspace at
 * all: any id that becomes current is then this tab's own save of it,
 * half-way, until the switch that ends the save records the open.
 */
let openId: string | null | undefined;

/**
 * Set once the empty state has been entered for a workspace deleted in
 * another tab, until something is opened again. Nothing else tells "already
 * left" from "open, with no files of its own".
 */
let left = false;

const recordOpen = () => {
  known = new WeakMap();
  for (const item of Object.values(PgExplorer.files)) {
    if (item.content !== undefined) known.set(item, item.content);
  }
  openName = PgExplorer.currentWorkspaceName;
  openId = PgExplorer.currentWorkspaceId;
  left = false;
};
PgExplorer.onDidSwitchWorkspace(recordOpen);
PgFs.onDidWriteFile((path, data) => {
  const item = PgExplorer.files[path];
  if (item) known.set(item, data);
});
// A temporary project -- a shared link -- is nothing this tab opened from
// disk. Forgotten, so that saving it as a workspace, which moves the same
// items under a new name, never reads as a rename to carry -- nor, while
// the save is still writing them, as a workspace to re-open: read back
// half-written, the tree would lose every file the save had yet to reach.
PgExplorer.onDidInit(() => {
  if (!PgExplorer.isTemporary) return;
  known = new WeakMap();
  openName = undefined;
  openId = null;
  left = false;
});
// Loaded after the first open, the events above were missed. State then is
// what was read, as far as anything here can tell.
if (PgExplorer.isInitialized && !PgExplorer.isTemporary) recordOpen();

/**
 * Whether a workspace's directory holds anything a delete would have taken.
 *
 * Not merely whether it exists: the editor runs `saveMeta` on an interval
 * while its tab has focus, and the write of `.workspace/metadata.json`
 * creates its parents. A tab that has not yet heard of a delete made
 * elsewhere recreates the directory around that one file -- and read as
 * "still there", that undid the delete in every tab.
 */
const holdsFiles = async (root: string): Promise<boolean> => {
  const walk = async (dir: string): Promise<boolean> => {
    for (const child of await PgFs.readDir(dir)) {
      const path = `${dir}/${child}`;
      if ((await PgFs.getMetadata(path)).isDirectory()) {
        if (await walk(path)) return true;
      } else if (path !== `${root}/.workspace/metadata.json`) {
        return true;
      }
    }
    return false;
  };

  try {
    return await walk(root);
  } catch (e) {
    if (isMissing(e)) return false;
    // A store that failed to read cannot say the workspace was deleted, and
    // putting back one that was is the cheaper mistake: a project to delete
    // again, rather than work dropped off the list
    report(`reload ${root}: read`, e);
    return true;
  }
};

/**
 * Leave a workspace another tab deleted, the way that tab did.
 *
 * With workspaces listed and none of them current, the explorer sidebar
 * throws on its next render -- the tree asks for the current workspace's
 * path. So this goes where `deleteWorkspace` sends the tab that deleted it:
 * the last workspace left, or the empty state when there is none.
 *
 * Only when the directory holds nothing. A delete removes it before the list
 * is saved, so files still there mean the list was written by a tab that had
 * not seen this workspace yet -- and that is put right instead.
 */
const leaveDeleted = async (): Promise<ReloadResult> => {
  // Already left, the deleted workspace's files and models are long gone,
  // and there is nothing of it to put back or drop. What is left to do is
  // the move itself, once there is somewhere to go: a neighbour that creates
  // a workspace lists one, and staying put then is the state the sidebar
  // throws on.
  const old = left ? undefined : memoryRoot();
  const id = PgExplorer.currentWorkspaceId;
  if (old && id && (await holdsFiles(`/${old}`)) && (await restore(old, id))) {
    return "unchanged";
  }

  const next = PgExplorer.allWorkspaceNames?.at(-1);
  if (next) {
    await PgExplorer.switchWorkspace(next);
    // Which the switch's own event does too, through `recordOpen`. Said here
    // as well, because this is what decides the next reload.
    left = false;
  } else if (left) {
    return "skipped";
  } else {
    // What the deleting tab ends up showing: the tree, tabs and editor
    // reset, and the gallery opening over the empty state. Not what its
    // `deleteWorkspace` does to get there -- that clears the current id,
    // saves the list and announces a switch, and the list on disk is
    // already the deleter's. Not `ON_DID_DELETE_WORKSPACE` either, which
    // would have sync delete the project a second time.
    await PgExplorer.init();
    left = true;
    // A lesson's route stays on the lesson otherwise. Its own handler for a
    // delete sends it home the same way, only when none are left.
    if (PgRouter.location.pathname.startsWith("/tutorials/")) {
      await PgRouter.navigate();
    }
  }

  // The deleted workspace's models would otherwise come back for a project
  // created later under the same name
  if (old) {
    await PgEditorModels.dropUnder(`/${old}/`, () => {
      if (next) {
        PgCommon.createAndDispatchCustomEvent(
          PgExplorer.events.ON_DID_OPEN_FILE,
          PgExplorer.getCurrentFile()
        );
      }
    });
  }
  return "reopened";
};

/**
 * Put this tab's workspace back on a list that lost it.
 *
 * Its files are still there, so it was not deleted: the list was saved by a
 * tab that had not seen it yet. Left off, the sidebar throws on its next
 * render -- workspaces listed, none current -- and the next save of any tab
 * makes the loss permanent. Registered again under the same name and id,
 * and saved, which tells the other tabs too.
 *
 * `importWorkspace` writes no files for an empty set and dispatches
 * `ON_DID_CREATE_WORKSPACE`. That re-renders the project switcher, and
 * `Flow.tsx` answers it by closing the gallery it opened over an empty
 * browser -- harmless here, where the list was not empty to begin with.
 *
 * @returns whether it is back. When it is not, the caller leaves it as a
 * deleted one, which is at least a state the sidebar can render; its files
 * stay where they are on disk.
 */
const restore = async (name: string, id: string): Promise<boolean> => {
  try {
    await PgExplorer.importWorkspace(name, { id, files: {} });
  } catch (e) {
    // The name is taken on the list that lost it, so it cannot go back
    report(`reload ${name}: put back`, e);
    return false;
  }
  return true;
};

/**
 * Write what this tab changed under a workspace's old name to its new one.
 *
 * A rename in another tab moves the directory, but this tab's tree, tabs and
 * models are still under the old name -- and every autosave from them now
 * fails, because the directory it writes into is gone. Waiting for those
 * keystrokes to land, as an ordinary re-open does, would wait for writes
 * that never happen, and the re-open after them would lose the text. So
 * they are carried over instead.
 *
 * Only this tab's own changes: an editor's unsaved text, or state that
 * differs from what this tab last had on disk -- an autosave that failed.
 * Anything else in memory is merely old. The other tab may well have edited
 * the file before renaming, and writing this tab's copy would undo that.
 */
const carryRename = async (from: string, to: string) => {
  for (const [path, item] of Object.entries(PgExplorer.files)) {
    if (!path.startsWith(`/${from}/`) || path.endsWith("/")) continue;
    if (item.content === undefined) continue;

    // A file with no record was created in this tab since the open:
    // `createItem` writes before the item is in state, so that write finds
    // nothing to record against. Its first autosave may be the one that
    // failed, so its state is this tab's own.
    const typed = await PgEditorModels.valueOf(path);
    let text: string | undefined;
    if (typed !== null && typed !== item.content) text = typed;
    else if (!known.has(item) || known.get(item) !== item.content) {
      text = item.content;
    }
    if (text === undefined) continue;

    const target = `/${to}/` + path.slice(from.length + 2);
    await PgFs.writeFile(target, text, { createParents: true });
  }
};

const reloadOnce = async (reopen: boolean): Promise<ReloadResult> => {
  if (PgExplorer.isTemporary) return "skipped";

  // The list first: a neighbour may have created, deleted or renamed a
  // workspace, and a re-open below saves this tab's list over the store's.
  // This tab's current one is kept by id, so a rename elsewhere is followed
  // by name, and a delete elsewhere leaves an id that names nothing.
  //
  // Not while this tab has a change of its own to the list in flight: the
  // explorer is between states. Deferred, not skipped: the change's own save
  // tells the other tabs, but nothing tells this one again of what the
  // neighbour wrote, so the caller asks again once the save has landed.
  if (!(await PgExplorer.refreshWorkspaces())) return "deferred";
  const name = PgExplorer.currentWorkspaceName;
  if (!name) {
    return PgExplorer.currentWorkspaceId ? await leaveDeleted() : "skipped";
  }

  const held = memoryRoot();
  const moved = !!held && held !== name;
  // A tree under a name this tab never opened, and that is not listed
  // either: a temporary project's `/src/...` on its way into a workspace.
  // There is nothing of a rename in it to follow.
  if (
    moved &&
    held !== openName &&
    !PgExplorer.allWorkspaceNames?.includes(held)
  ) {
    return "skipped";
  }
  // The current id has moved on from the one the tree was opened under:
  // this tab's own switch, half-way -- the new current one is named before
  // its tree is read. Not a rename, and the switch is about to finish what a
  // reload would do. By id, not by name: another tab may rename this
  // workspace and then create a new one under its old name, and by name
  // that reads as a switch and gets stuck.
  const switching =
    openId !== undefined
      ? PgExplorer.currentWorkspaceId !== openId
      : moved && !!PgExplorer.allWorkspaceNames?.includes(held);
  if (switching) return "skipped";

  // Before the read, not after it. An autosave puts the text into state and
  // only then writes it, so one that runs while the store is being read can
  // leave state newer than what the read found. Taken afterwards, that newer
  // state would be compared with the older disk -- and replaced by it.
  const memory = inMemory();

  const disk = await readTree(`/${name}`);
  if (!disk) return "skipped";
  // The user may have switched projects while the store was being read
  if (PgExplorer.currentWorkspaceName !== name) return "skipped";

  // Past that, the same id with the tree under another name is a rename
  // made in another tab
  const renamed = moved;
  if (reopen || renamed || !sameKeys(disk, memory)) {
    // A re-open rebuilds every model from state, so keystrokes autosave has
    // not written yet -- in any file, not only the open one -- would go.
    // Nothing forces this one, so it stands down as `deferred` instead, and
    // is asked again once autosave has had its turn. A forced re-open is
    // `adopt`, where the user has already chosen to discard.
    //
    // Renamed in another tab, there is nothing to wait for: autosave writes
    // under the old name, which is gone. The text is carried across instead.
    if (!reopen && held && renamed) {
      await carryRename(held, name);
      if (PgExplorer.currentWorkspaceName !== name) return "skipped";
    } else if (!reopen) {
      const edited = await PgEditorModels.anyEditedUnder(
        `/${name}/`,
        (path) => PgExplorer.files[path]?.content
      );
      if (edited) return "deferred";
      if (PgExplorer.currentWorkspaceName !== name) return "skipped";
    }

    // The switch first, then the models. `switchWorkspace` re-reads state
    // from disk, but the editor reuses any model it already has for a path,
    // so the stale ones have to go -- and they have to go *after* it. Its
    // saves are real waits, `Monaco.tsx`'s autosave timer can fire during
    // any of them, and with the models already gone that timer saves the
    // empty editor over the open file. Opening the current file straight
    // after the drop, in the same task, leaves no such window at this end.
    await PgExplorer.switchWorkspace(name);
    await PgEditorModels.dropUnder(`/${name}/`, () =>
      PgCommon.createAndDispatchCustomEvent(
        PgExplorer.events.ON_DID_OPEN_FILE,
        PgExplorer.getCurrentFile()
      )
    );
    // Renamed in another tab: the old name's models would otherwise come
    // back for a project created under it later. Last, once the editor is
    // showing the new one's.
    if (held && held !== name) await PgEditorModels.dropUnder(`/${held}/`);
    return "reopened";
  }

  const changed: string[] = [];
  for (const [path, content] of Object.entries(disk)) {
    if (memory[path] === content) continue;
    // Changed in state while the store was being read: an autosave whose
    // write had not landed when this file was read. Its text is newer.
    if (PgExplorer.files[path]?.content !== memory[path]) continue;
    // A model that differs from state holds keystrokes autosave has not
    // written yet. They are this tab's, and newer than anything on disk.
    const typed = await PgEditorModels.valueOf(path);
    if (typed !== null && typed !== memory[path]) continue;

    // Straight into state, not `saveFileToState`: that dispatches the save
    // event, which schedules an upload of what another tab already uploaded
    PgExplorer.files[path].content = content;
    known.set(PgExplorer.files[path], content);
    changed.push(path);
  }
  if (!changed.length) return "unchanged";

  await PgEditorModels.drop(changed);
  const open = PgExplorer.getCurrentFile();
  if (open && changed.includes(open.path)) {
    // What `switchWorkspace` does to show a file: `Monaco.tsx` answers by
    // building the model again from state, and restarts its position timer
    // against the new model rather than the disposed one
    PgCommon.createAndDispatchCustomEvent(
      PgExplorer.events.ON_DID_OPEN_FILE,
      open
    );
  }
  return "contents";
};

let queue: Promise<ReloadResult> = Promise.resolve("skipped");

/**
 * Bring the workspace this tab has open back in line with the store.
 *
 * Tabs share IndexedDB but each holds the current workspace in memory, so a
 * tab that another tab has written underneath goes on showing -- and
 * uploading, and autosaving -- the old copy. Disk is the one place both tabs
 * agree on, file by file, because an edit reaches it straight after it
 * reaches state.
 *
 * Contents alone are taken quietly: no switch, no reconcile, no upload. A
 * change in which files exist re-opens the workspace, which is rare and worth
 * its cost.
 *
 * Serialized: a reload asked for while one runs waits for it, then looks
 * again, because what it read may already be out of date.
 *
 * @param opts -
 * - `reopen`: re-open even when only contents differ. `adopt` needs it,
 *   because the adopted snapshot also carries the program keypair, and only
 *   a switch makes `PgProgramInfo` read that again.
 */
export const reloadCurrentFromDisk = (
  opts: { reopen?: boolean } = {}
): Promise<ReloadResult> => {
  const run = () => reloadOnce(opts.reopen === true);
  queue = queue.then(run, run);
  return queue;
};

// Development only, like `__pgSyncDiagnostics`: `craco build` sets NODE_ENV
// to production, so this is dropped from the shipped bundle. The browser
// tests need the open workspace's id -- the one sync uploads it under -- and
// the text the editor holds for the open file, which `.view-lines` shows
// only as far as the view is scrolled. Neither is on screen otherwise.
if (process.env.NODE_ENV !== "production") {
  (
    window as unknown as {
      __pgWorkspace?: {
        id: () => string | null;
        openText: () => Promise<string | null>;
      };
    }
  ).__pgWorkspace = {
    id: () => PgExplorer.currentWorkspaceId ?? null,
    openText: async () => {
      const path = PgExplorer.currentFilePath;
      return path ? await PgEditorModels.valueOf(path) : null;
    },
  };
}
