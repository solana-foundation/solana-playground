import { PgSession } from "../../features/auth";
import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { report } from "../../features/persistence/model/diagnostics";
import { PgProjectSync } from "../../features/persistence/model/project-sync";
import { syncProjectsFromServer } from "../../features/persistence/model/project-restore";
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
   * Take on the account's work, then hand over anything it has not got.
   *
   * **Pull before push**, which is the opposite of what it was. Pushing first
   * meant a device with a blank local copy of a project the account already
   * had -- a tutorial opened by link on a second browser, whose id is derived
   * and so collides by design -- announced itself with a write the server
   * refused, and the user got a conflict banner for what was really just a
   * device that had not caught up. Reading first makes the server's copy the
   * one this browser holds, and makes every later push a compare-and-swap
   * against something actually read, so a conflict from then on means what it
   * says: another session is editing this project too.
   *
   * The push that follows is for work the server has never seen -- a project
   * started here while signed out. Taking the server's copy first records its
   * hash, so a project that was just pulled is not sent straight back up.
   *
   * @param openLatest whether to open the account's most recently touched
   * project afterwards. True when the user has just signed in, where landing
   * on their newest work is the point of signing in; false when a cookie was
   * merely restored on load, where it would yank them off whatever URL they
   * opened.
   */
  const adopt = async ({ openLatest }: { openLatest: boolean }) => {
    await PgChatSync.pushAll();

    let result;
    try {
      result = await syncProjectsFromServer();
    } finally {
      // Whatever happened, pushes stop waiting here. A reconcile that failed
      // is a reason to let this device save its work, not to hold it forever.
      PgProjectSync.releasePushes();
    }

    const current = PgExplorer.currentWorkspaceName;
    // Only the current workspace has in-memory state, so it is the only one
    // whose files changing underneath leaves the editor showing something
    // that is no longer on disk. Re-opening it is what refreshes that.
    const stale = !!current && result.replaced.includes(current);

    // A browser with nothing open is not being yanked off anything, so it
    // opens the newest project whether or not this was a fresh sign-in --
    // otherwise a device that has just pulled the whole account down sits
    // there saying "No project" with every one of them already on disk.
    const target =
      openLatest || !current
        ? result.latest ?? current
        : stale
        ? current
        : null;
    if (target && PgExplorer.allWorkspaceNames?.includes(target)) {
      await PgExplorer.switchWorkspace(target);
    }

    // Last, not first. Only the current workspace is held in memory, and until
    // the switch above re-reads it, that memory is still the copy the server
    // has just replaced -- so pushing here sent this device's *stale* files
    // back up over the version it had only just pulled down, on every single
    // reload. What is left to hand over is a project the server has never had.
    await PgProjectSync.pushCurrent();
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

  PgSession.setOnSignOut(() => PgChatSync.handOver());

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
