import { PgSession } from "../../features/auth";
import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { report } from "../../features/persistence/model/diagnostics";
import { PgProjectSync } from "../../features/persistence/model/project-sync";
import {
  reconcile,
  releaseLocalProjects,
} from "../../features/persistence/model/project-restore";
import { PgThreadIndex } from "../../features/persistence/model/thread-index";
import { PgAssistant } from "../../views/sidebar/assistant/store";
import { openThread } from "../chat-thread/open-thread";
// Deep import rather than the `utils` barrel, which reaches `settings.ts` and
// a webpack-defined global jest cannot resolve. Same workaround as
// `snapshot.ts`, and what makes this effect testable.
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
   * project afterwards. True when the user has just signed in, where landing
   * on their newest work is the point of signing in; false when a cookie was
   * merely restored on load, where it would yank them off whatever URL they
   * opened.
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
      PgProjectSync.releasePushes();
    }

    // The panel is still showing the thread it opened before sign-in, which
    // the adoption above may have repointed the workspace away from
    const workspaceId = PgExplorer.currentWorkspaceId;
    const open = PgAssistant.threadId;
    const wanted = workspaceId && (await PgThreadIndex.get(workspaceId));
    if (workspaceId && wanted && open && open !== wanted) {
      await openThread(workspaceId, wanted);
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
   * Hand everything over, then forget this account.
   *
   * Order matters in both halves. The push has to happen while the cookie is
   * still valid, and the teardown has to happen after it: closing the thread
   * before `handOver` would discard messages that had not been uploaded, and
   * leaving it open afterwards means the panel keeps rendering the previous
   * user's transcript and writes it straight back into storage the next time
   * anything changes -- from where the next account's sign-in dump uploads it.
   *
   * `releaseLocalProjects` is the same move for code, and runs here for the
   * same reason: it needs the session to still be readable, because a mark is
   * keyed by the user id and `PgSyncMark.read` answers `null` without one --
   * which would make every project look unsynced and none of them removable.
   */
  const relinquish = async () => {
    // Independently, not one `try` around both: the two hand-overs answer for
    // different data, and a conversation that could not be uploaded is no
    // reason to leave the account's projects on a browser it is done with.
    try {
      await PgChatSync.handOver();
    } catch (e) {
      report("hand over conversations", e);
    }

    try {
      await releaseLocalProjects();
    } catch (e) {
      report("release local projects", e);
    }

    PgAssistant.closeThread();
    PgProjectSync.forgetAccount();
  };

  // Held from here, before anything can fire, and released the moment the
  // reconcile is done. The editor's own push is debounced by seconds and the
  // reconcile is several round trips -- without this, whichever won decided
  // whether the user was told their other device had changed the project.
  PgProjectSync.holdPushes();

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
      void adopt({ openLatest: restored }).catch((e) => report("adopt", e));
    }
    signedIn = nowSignedIn;
  });

  PgSession.setOnSignOut(relinquish);

  void PgSession.refresh().then(() => {
    restored = true;
    // Signed out, so no reconcile is coming and nothing should be waiting on
    // one. `adopt` releases in its own right when there is a session.
    if (!PgSession.get()) PgProjectSync.releasePushes();
  });

  return {
    dispose: () => {
      onChange.dispose();
      PgSession.setOnSignOut(null);
      // Nothing is left to release the gate once this is gone
      PgProjectSync.releasePushes();
    },
  };
};
