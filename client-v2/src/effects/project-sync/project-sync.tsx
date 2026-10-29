import { report } from "../../features/persistence/model/diagnostics";
import { PgProjectSync } from "../../features/persistence/model/project-sync";
import { reconcile } from "../../features/persistence/model/project-restore";
import {
  isSyncedWorkspaceFile,
  snapshotOf,
} from "../../features/persistence/model/snapshot";
import { PgSyncBase } from "../../features/persistence/model/sync-base";
import { PgAccountList } from "../../features/persistence/model/account-list";
import { PgSyncClaim } from "../../features/persistence/model/sync-claim";
import { PgSyncMark } from "../../features/persistence/model/sync-mark";
import { PgThreadIndex } from "../../features/persistence/model/thread-index";
import { PgWorkspaceRegistry } from "../../features/persistence/model/workspace-registry";
import { PgFs } from "../../utils/explorer/fs";
// Deep import rather than the `utils` barrel: the barrel reaches `settings.ts`,
// which reads `GLOBAL_SETTINGS`, a global only webpack defines, so the unit
// tests could not load this module.
import { PgExplorer } from "../../utils/explorer/explorer";
import type { Disposable } from "../../utils/types";

/** Long enough that typing is one upload, short enough to survive a crash */
const DEBOUNCE_MS = 3000;

const isVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Mirror the current workspace to Postgres as it changes, and keep this tab
 * from writing anything stale.
 *
 * An app-level effect for the same reason `chatThread` is one: the explorer
 * panel can be collapsed, and whether the user's code is backed up must not
 * depend on whether anyone is looking at the file tree.
 *
 * ## Why visibility matters
 *
 * Only one person uses a playground, but that person can still have more than
 * one writer open -- a second tab, or a laptop left open at home. `PgExplorer`
 * is backed by IndexedDB, which tabs share, but the *current* workspace is held
 * in memory per tab. So a tab that has been in the background for a day holds a
 * snapshot of files that have since moved on, and the moment anything nudges it
 * that snapshot is what it uploads.
 *
 * Hence the two rules here: a tab only pushes while it is visible, and a tab
 * that has just become visible reconciles before it is allowed to push again.
 * The push gate that already existed for page load is what enforces the second.
 */
export const projectSync = (): Disposable => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const push = async () => {
    const result = await PgProjectSync.pushCurrent();
    // The mark now says what the server took, so the next edit has something
    // new to record
    if (result === "ok") flagged = false;
    return result;
  };

  /**
   * Record the intent to upload before the upload is attempted.
   *
   * Written now rather than when the push fails, so that a tab closed or
   * crashed between the keystroke and the request still reads as having
   * unsaved work on the next load -- which is what stops the reconcile there
   * taking the server's older copy over it.
   *
   * At most once per debounce window. The mark is a single boolean as far as
   * this is concerned, so writing it again on the next keystroke changes
   * nothing -- and it costs a filesystem read, on the same queue as the writes
   * that triggered it. Doing that per write made creating a workspace roughly
   * five times slower, because the files written during setup each queued one
   * behind the writes still in flight.
   */
  let flagged = false;
  const flag = () => {
    if (flagged) return;
    const id = PgExplorer.currentWorkspaceId;
    if (!id) return;

    flagged = true;
    void PgSyncMark.markDirty(id).catch((e) => report("mark dirty", e));
  };

  const scheduleOnly = () => {
    if (timer) clearTimeout(timer);
    // A hidden tab records the change and leaves it there. Whatever is visible
    // owns the upload, and this tab reconciles before it pushes again.
    if (!isVisible()) return;
    timer = setTimeout(() => void push(), DEBOUNCE_MS);
  };

  const schedule = () => {
    flag();
    scheduleOnly();
  };

  const flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
    void push();
  };

  /**
   * Remember what the project opened with.
   *
   * This is where a merge's base content comes from: the next push compares
   * against the last agreement, and keeps the opened content of any file that
   * changed since. Taken on switch because that is the moment the in-memory
   * copy is fresh -- the switch fires on every page load too, though before
   * this effect mounts, so the mount takes one as well.
   *
   * @param opts -
   * - `keepHeld`: leave a shadow already held for the project. The mount's
   *   read can land after an accepted upload took the agreement, and after an
   *   edit, and replacing the one with the other loses that file's base.
   */
  const shadow = async (opts: { keepHeld?: boolean } = {}) => {
    const id = PgExplorer.currentWorkspaceId;
    const name = PgExplorer.currentWorkspaceName;
    if (!id || !name) return;
    try {
      // Off the store, which every tab shares: this tab's memory can be
      // behind another tab's write
      const { files } = await snapshotOf(name);
      // A switch that landed during the read has its own shadow coming
      if (PgExplorer.currentWorkspaceId !== id) return;
      // One taken meanwhile, by an accepted upload, is the agreement; this
      // read may already hold an edit made since
      if (opts.keepHeld && PgSyncBase.isTracking(id)) return;
      PgSyncBase.track(id, files);
    } catch (e) {
      report("shadow workspace", e);
    }
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
    PgExplorer.onDidRenameWorkspace((renamed) => {
      // The current workspace: an edit like any other
      if (!renamed?.id || renamed.id === PgExplorer.currentWorkspaceId) {
        schedule();
        return;
      }
      // One the user renamed from the navigation's project list without opening it.
      // Nothing else would ever send that name: its row has not moved and
      // its mark is clean, so reconcile's cheap path skips it, and the
      // editor's pushes are only ever for the open project. Flagged, the
      // next pass sees the name differ and uploads it -- and that pass is
      // asked for now.
      const { id } = renamed;
      void PgSyncMark.markDirty(id)
        .catch((e) => report("mark dirty", e))
        .then(() => refresh("rename"));
    }),
    // Flushed, not scheduled: the debounce belongs to the workspace being
    // left, and `pushCurrent` reads whichever one is current when it runs. A
    // switch mid-debounce used to upload the *incoming* project under the
    // outgoing one's pending timer, so the outgoing one's edits were simply
    // dropped.
    //
    // Opening a project is also the moment to find out whether another device
    // has moved it on. The conversation was already pulled here (`chatThread`)
    // and the code was not, so switching into a project showed its stale local
    // copy until a reload or a tab refocus.
    //
    // No `flag()`: opening a project is not editing it. This event also fires
    // on every page load, so flagging here marked every project as having
    // unsaved work before the user had touched anything -- which made
    // reconcile unable to take the server's copy silently and turned an
    // ordinary "the other device is ahead" into a question.
    PgExplorer.onDidSwitchWorkspace(() => {
      flush();
      // A different project, so whatever was flagged was the last one's
      flagged = false;
      void shadow();
      refresh("switch");
    }),

    // Three files in the snapshot -- the tutorial's page, its storage, and the
    // program keypair -- are written straight to the store by `PgTutorial` and
    // `PgProgramInfo`, so none of the events above fires for them. They are
    // also the only files in the snapshot that are not ordinary source, which
    // made this the one gap where sync silently carried nothing: a tutorial
    // resumed on another device at page one, and the same project deployed to
    // a different address on every browser.
    PgFs.onDidWriteFile((path) => {
      if (isSyncedWorkspaceFile(path)) schedule();
    }),
    // Not while this tab is signing out. The sign-out path removes this
    // browser's copy of projects the account keeps, and every one of those
    // arrives here as the same event a user deleting a project raises --
    // which `settleLocalDeletes` answers by tombstoning the row and clearing
    // its snapshot. Signing out therefore emptied the account, and signing
    // back in restored nothing because nothing was left.
    PgExplorer.onDidDeleteWorkspace(() => {
      if (PgProjectSync.isSigningOut) return;
      void settleLocalDeletes();
    }),
    // A tutorial started here has the id another account's copy had, and
    // without a claim its pushes read as that account's leftover project and
    // never went up. An import needs none: sync writes its mark.
    PgExplorer.onDidCreateWorkspace(({ id, imported }) => {
      if (id && !imported) void PgSyncClaim.claim(id);
    }),
  ];

  /**
   * Tell the server about a workspace deleted here.
   *
   * `onDidDeleteWorkspace` carries no id, so the deleted project is found by
   * elimination: a sync mark whose id no longer resolves to a workspace. That
   * is also exactly the set whose chat threads are now orphaned.
   *
   * Without the DELETE the tombstone machinery on the server was unreachable,
   * and the next reconcile re-imported the project from a row that was still
   * live -- deleting a project was undone by a reload.
   *
   * Decided against the store, not only this tab's list. Marks are shared by
   * every tab, and this tab's list can be behind a neighbour's: a project
   * created and synced in another tab has a mark, and no name here until
   * this tab next re-reads the list. Taken from memory alone, deleting any
   * project here deleted that one too -- on the server, chat included.
   * Not by re-reading the list here: that is the reload's to do, inside its
   * own queue, where nothing is half-way through when the list changes.
   *
   * Once every delete reached an account whose list was read, a browser left
   * with no workspace marks that list empty (`PgAccountList`), which is what
   * lets Home offer the example to a signed-in account again.
   */
  const settleLocalDeletes = async () => {
    // Whether every delete below reached the account; one that did not leaves
    // the project alive there
    let allReached = true;
    try {
      for (const projectId of await PgSyncMark.projectIds()) {
        if (PgExplorer.workspaceNameOf(projectId)) continue;
        // Listed in the store, or the store cannot say: not deleted, or not
        // known to be
        if ((await PgWorkspaceRegistry.lists(projectId)) !== false) continue;

        if (!(await PgProjectSync.remove(projectId))) allReached = false;
        await PgSyncMark.remove(projectId);
        // A tutorial's id is derived from its name, so deleting and restarting
        // one produces the same id -- and without this the previous run's
        // conversation reappears inside the new one. Through the index, by
        // workspace id, which is all a delete knows: storage is keyed by
        // thread id.
        await PgThreadIndex.forget(projectId);
      }

      // A workspace deleted before its first upload has a claim and no mark,
      // so the loop above never meets it. Left behind, the claim would vouch
      // for another account's project that later turns up under the same id.
      // Every account's, not the signed-in one's: a workspace deleted after
      // its account signed out takes that account's claim with it.
      for (const projectId of await PgSyncClaim.projectIds()) {
        if (PgExplorer.workspaceNameOf(projectId)) continue;
        if ((await PgWorkspaceRegistry.lists(projectId)) !== false) continue;
        await PgSyncClaim.forget(projectId);
      }

      // The account's list was read, and every delete above reached it, so a
      // browser left with no project means an account with none: Home offers
      // the example again. An unread list stays unread: a delete here says
      // nothing of projects the account holds that this browser never saw
      if (
        allReached &&
        PgAccountList.state === "holds" &&
        PgExplorer.allWorkspaceNames?.length === 0
      ) {
        PgAccountList.listed(0);
      }
    } catch (e) {
      report("settle local deletes", e);
    }
  };

  /**
   * Find out what the account holds, without letting this tab write meanwhile.
   *
   * Coming back to a backgrounded tab and opening a project are the same
   * problem as loading the page: all three start from state that may be
   * arbitrarily out of date, and in all three the safe order is stop pushing,
   * read, then resume.
   */
  let refreshing = false;
  const refresh = (what: string) => {
    // Deleting the current workspace switches to another one on the way past,
    // so sign-out's release dispatches switches of its own. Reconciling on
    // one re-imports every project it has just removed -- the row is live and
    // the local copy is gone, which is precisely `importFresh` -- and the
    // account's projects land straight back on a browser being handed over.
    if (PgProjectSync.isSigningOut) return;

    // Not re-entrant, and it has to say so out loud: taking another device's
    // copy re-opens the workspace whose files it just replaced, and re-opening
    // dispatches a switch. Without this, a reconcile that adopts anything
    // triggers a reconcile, which adopts, which triggers... and the two bounce
    // off each other for as long as the tab is open. It showed up as a project
    // being uploaded dozens of times a second.
    //
    // Dropping the second request rather than queueing it is right: a
    // reconcile already in flight is about to read the same account.
    //
    // Kept although `reconcile` now runs one pass at a time and queues the
    // rest, which is what keeps this effect's passes apart from the session's.
    // Queued, a pass that adopts would start the next one through its own
    // re-open, and the bounce would end only because that next pass happened
    // to find nothing to adopt. This ends it by construction.
    if (refreshing) return;
    refreshing = true;

    PgProjectSync.holdPushes();
    void reconcile()
      .catch((e) => report(`reconcile on ${what}`, e))
      .finally(() => {
        PgProjectSync.releasePushes();
        refreshing = false;
      });
  };

  const onVisibilityChange = () => {
    if (!isVisible()) return flush();
    refresh("focus");
  };

  // The project already on screen. `<Effects />` mounts after a delay, by
  // which time the page load's switch has fired, and with no shadow the first
  // push after a load kept no base: a 409 there asked about every file whole.
  void shadow({ keepHeld: true });

  document.addEventListener("visibilitychange", onVisibilityChange);
  // `pagehide` rather than `beforeunload`: browsers cancel in-flight
  // non-`keepalive` fetches when the document unloads, so the old flush there
  // saved nothing in practice. `pagehide` fires for the bfcache case too, and
  // the `hidden` transition above covers an ordinary tab close -- at which
  // point the document is still alive and a normal fetch completes.
  window.addEventListener("pagehide", flush);

  return {
    dispose: () => {
      if (timer) clearTimeout(timer);
      for (const sub of subscriptions) sub.dispose();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    },
  };
};
