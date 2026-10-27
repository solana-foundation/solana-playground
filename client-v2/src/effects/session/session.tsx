import { PgSession } from "../../features/auth";
import { PgChatSync } from "../../features/persistence/model/chat-sync";
import type { HandOver } from "../../features/persistence/model/chat-sync";
import { report } from "../../features/persistence/model/diagnostics";
import { PgProjectSync } from "../../features/persistence/model/project-sync";
import {
  reconcile,
  releaseLocalProjects,
} from "../../features/persistence/model/project-restore";
import { PgThreadIndex } from "../../features/persistence/model/thread-index";
import { PgAssistant } from "../../views/sidebar/assistant/store";
import { openThread } from "../chat-thread/open-thread";
// Deep import rather than the `utils` barrel: the barrel reaches `settings.ts`,
// which reads `GLOBAL_SETTINGS`, a global only webpack defines, so the unit
// tests could not load this module.
import { PgExplorer } from "../../utils/explorer/explorer";
import type { Disposable } from "../../utils/types";

/**
 * Restore the signed-in user on load, and reconcile this browser with the
 * account.
 *
 * The Better Auth session lives in an HttpOnly cookie, so the browser holds it
 * but the app does not know about it until it asks. Without this a reload
 * renders as signed out while the cookie is still valid, and nothing syncs.
 *
 * This is also where the auth and persistence slices are joined. Neither knows
 * about the other -- `features/persistence` imports `features/auth` for the
 * current user, and wiring the reverse direction directly would make the two
 * circular -- so the composition happens out here, in the effect layer that is
 * allowed to know about both.
 *
 * `refresh` never throws; it treats any failure as signed out.
 */
export const session = (): Disposable => {
  /**
   * Wait for the explorer to exist.
   *
   * Effects mount from `app/Effects/Effects.tsx` concurrently with the async
   * `PgExplorer.init()` in `routes/common.tsx`, so a session that resolves
   * first would reconcile against a workspace list that is not there yet --
   * `workspaceNameOf` returns `undefined` for everything and `importWorkspace`
   * throws `NOT_FOUND`. The per-project catch turns that into a diagnostics
   * line, so the entire account sync fails invisibly and the user is left
   * looking at an empty playground. `Flow.tsx` gates on the same event.
   *
   * The initialized check comes first because the event does not replay: if
   * init won the race, subscribing would wait for a second one that never
   * comes.
   */
  const explorerReady = () =>
    new Promise<void>((resolve) => {
      if (PgExplorer.isInitialized) return resolve();
      const sub = PgExplorer.onDidInit(() => {
        sub.dispose();
        resolve();
      });
    });

  /**
   * Take on the account's work, and hand over anything it has not got.
   *
   * `reconcile` decides both directions per project and only asks the user
   * where both copies hold work. What used to be here instead -- take the
   * server's copy of everything, then push -- could not tell "this device is
   * behind" from "this device has work that never uploaded", and resolved that
   * ambiguity by overwriting.
   *
   * @param openLatest whether to open the account's most recently touched
   * project afterwards. True when the user has just signed in from the header,
   * where landing on their newest work is the point of signing in; false when
   * a cookie was merely restored on load, where it would yank them off
   * whatever URL they opened, or when the sign-in started in the assistant
   * panel, mid-task.
   */
  const adopt = async ({ openLatest }: { openLatest: boolean }) => {
    let result;
    try {
      // Inside the `try`, all of it. Pushes are held from the moment this
      // effect is created, and this is the only thing that releases them --
      // so anything that throws on the way to the reconcile, waiting for the
      // explorer or handing the chat threads over, leaves every project on
      // this device unable to save for the rest of the session, silently.
      await explorerReady();
      // Before the dump: it would upload a thread minted while signed out as
      // a conversation of its own, and the account's would never be found
      await PgChatSync.adoptAccountThreads();
      await PgChatSync.pushAll();
      result = await reconcile();
    } finally {
      // Whatever happened, pushes stop waiting here. A reconcile that failed
      // is a reason to let this device save its work, not to hold it forever.
      releaseHold();
    }

    // The panel is still showing the thread it opened before sign-in, which
    // the adoption above may have repointed the workspace away from. Opened
    // again even when it was not: on load the chat effect opens the thread
    // before the cookie is restored, so its pull stands down without asking
    // the server, and this is the first moment a pull is certain to find a
    // session. Skipping an unchanged thread left the panel showing only what
    // this browser had stored, and the other device's messages never arrived.
    //
    // A turn may well be running by now -- this is several round trips after
    // load. For an unchanged thread the server's copy is folded into memory
    // rather than reloaded, which leaves the turn alone. The one case that
    // changes the thread id (the server has never seen the thread and the
    // account holds another for the workspace) repoints the panel and keeps
    // memory too; see `openThread`.
    //
    // The workspace is checked again after the index read: a switch landing
    // inside it has already opened the new workspace's thread, and this must
    // not repaint the old one over it.
    //
    // Caught on its own, so a failure here cannot skip re-opening a
    // workspace whose files reconcile has just replaced.
    try {
      const workspaceId = PgExplorer.currentWorkspaceId;
      const open = PgAssistant.threadId;
      const wanted = workspaceId && (await PgThreadIndex.get(workspaceId));
      if (
        workspaceId &&
        wanted &&
        open &&
        PgExplorer.currentWorkspaceId === workspaceId
      ) {
        await openThread(workspaceId, wanted);
      }
    } catch (e) {
      report("open thread", e);
    }

    const current = PgExplorer.currentWorkspaceName;
    // Only the current workspace has in-memory state, so it is the only one
    // whose files changing underneath leaves the editor showing something
    // that is no longer on disk. Re-opening it is what refreshes that.
    const stale = !!current && result.replaced.includes(current);
    // The workspace the user was in may have been deleted on another device
    // and settled here, in which case there is nothing to go back to
    const gone = !!current && result.removed.includes(current);

    // A browser with nothing open is not being yanked off anything, so it
    // opens the newest project whether or not this was a fresh sign-in --
    // otherwise a device that has just pulled the whole account down sits
    // there saying "No project" with every one of them already on disk.
    const target =
      openLatest || !current || gone
        ? result.latest ?? (gone ? null : current)
        : stale
        ? current
        : null;
    if (target && PgExplorer.allWorkspaceNames?.includes(target)) {
      await PgExplorer.switchWorkspace(target);
    }
  };

  /**
   * Hand everything over, and return how to forget this account.
   *
   * Two halves, and `PgSession.signOut` runs the request between them. The
   * push has to happen while the cookie is still valid; the teardown only once
   * the server has ended the session. Tearing down before the request meant a
   * sign-out the server refused -- cookie intact, user signed back in on
   * reload -- had already closed their conversation, removed their projects
   * from the browser and dropped sync's names and conflicts.
   *
   * The teardown stops any running turn, then closes the thread. Left open,
   * the panel keeps rendering the previous user's transcript and writes it
   * straight back into storage the next time anything changes -- from where
   * the next account's sign-in dump uploads it. What is stored survives the
   * close: the upload has already happened, `closeThread` persists nothing,
   * and `forget` keeps any thread written to since. The turn is stopped on
   * its own (`stopTurn`), because `closeThread` does nothing with no thread
   * open: its request is aborted, an approval it waits on is denied, and
   * nothing it writes afterwards reaches the thread opened next. With no
   * thread open, what the panel holds was never stored, and the next thread
   * to open would adopt it: `clear` drops it. The thread closes again last,
   * because removing the open project switches workspace and the chat effect
   * opens the next one's thread; that effect opens a fresh one once the user
   * is cleared.
   *
   * `releaseLocalProjects` is `forget`'s counterpart for code. It runs before
   * `signOut` clears the user, because a mark is keyed by the user id and
   * `PgSyncMark.read` answers `null` without one -- which would make every
   * project look unsynced and none of them removable.
   */
  const relinquish = async () => {
    // Independently, not one `try` around both, here and in the teardown: the
    // conversations and the projects are separate data, and one failing is no
    // reason to skip the other.
    let handed: HandOver | null = null;
    try {
      handed = await PgChatSync.pushAll();
    } catch (e) {
      report("hand over conversations", e);
    }

    // The editor's push is debounced by seconds, so the workspace in front of
    // the user is the one most likely to hold something the server has not
    // seen. Best effort: if this fails, that project fails `isClean` in
    // `releaseLocalProjects` and is kept, which is the outcome we want anyway.
    try {
      await PgProjectSync.pushCurrent();
    } catch (e) {
      report("flush before sign-out", e);
    }

    return async () => {
      const step = async (what: string, fn: () => unknown) => {
        try {
          await fn();
        } catch (e) {
          report(what, e);
        }
      };

      // Stopped on its own as well: with no thread open the close below does
      // nothing, and a turn running there would carry on for the next account
      await step("stop turn", () => PgAssistant.stopTurn());
      await step("close thread", () => PgAssistant.closeThread());
      // With no thread open the close keeps what the panel holds, for the
      // thread that opens next to adopt -- here, the next account's
      await step("drop unsaved messages", () => PgAssistant.clear());
      // A write the panel queued before closing lands now, so `forget` sees it
      await step("wait for chat writes", () => PgAssistant.whenPersisted());
      await step("forget conversations", () => PgChatSync.forget(handed));
      await step("release local projects", () => releaseLocalProjects());
      await step("close thread", () => PgAssistant.closeThread());
      await step("forget account", () => PgProjectSync.forgetAccount());
    };
  };

  // Held from here, before anything can fire, and released the moment the
  // reconcile is done. The editor's own push is debounced by seconds and the
  // reconcile is several round trips -- without this, whichever won decided
  // whether the user was told their other device had changed the project.
  PgProjectSync.holdPushes();
  // Exactly once, however many of the paths below get there. The gate is
  // counted, so a second release here would give up somebody else's hold --
  // a merge's, say -- and let the editor upload while it was rewriting files.
  let holding = true;
  const releaseHold = () => {
    if (!holding) return;
    holding = false;
    PgProjectSync.releasePushes();
  };

  // The first transition is the cookie being restored on load, not the user
  // signing in -- `refresh` fires it before its own promise settles. Anything
  // after that is a real sign-in, and only that one takes the user somewhere.
  let restored = false;
  let signedIn = !!PgSession.get();
  const onChange = PgSession.onDidChange(() => {
    const nowSignedIn = !!PgSession.get();
    // Nothing awaits this, so a failure here would otherwise surface as an
    // unhandled rejection and nowhere else. It is reported and swallowed: the
    // app has to keep working offline, and `__pgSyncDiagnostics.failures()` is
    // where a sync that did not happen can be found.
    if (nowSignedIn && !signedIn) {
      // A panel sign-in happens mid-task, with a prompt written for the open project
      const fromPanel = PgSession.signingInFrom === "assistant";
      void adopt({ openLatest: restored && !fromPanel }).catch((e) =>
        report("adopt", e)
      );
    }
    signedIn = nowSignedIn;
  });

  PgSession.setOnSignOut(relinquish);

  void PgSession.refresh().then(() => {
    restored = true;
    // Signed out, so no reconcile is coming and nothing should be waiting on
    // one. `adopt` releases in its own right when there is a session.
    if (!PgSession.get()) releaseHold();
  });

  return {
    dispose: () => {
      onChange.dispose();
      PgSession.setOnSignOut(null);
      // Nothing is left to release the gate once this is gone
      releaseHold();
    },
  };
};
