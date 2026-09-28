import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { report } from "../../features/persistence/model/diagnostics";
import { PgThreadIndex } from "../../features/persistence/model/thread-index";
import { PgAssistant } from "../../views/sidebar/assistant/store";
// Deep import rather than the `utils` barrel, which reaches `settings.ts` and
// a webpack-defined global jest has no answer for. Same workaround as the
// other effects; here it is what makes this file testable at all.
import { PgExplorer } from "../../utils/explorer/explorer";
import type { Disposable } from "../../utils/types";
import { openThread } from "./open-thread";

/**
 * Keep the open conversation pointed at the current workspace, and get it to
 * the server before the tab goes away.
 *
 * An app-level effect rather than something the assistant panel does, because
 * the panel is not always mounted -- it can be collapsed, or showing the
 * backend picker -- and which conversation is open must not depend on whether
 * anyone is looking at it. Otherwise a message sent right after a project
 * switch lands in the previous project's thread, or in none at all.
 *
 * Which conversation that is comes from the thread index, not from the
 * workspace id itself: a thread has an id of its own so a project can hold
 * more than one. The workspace decides which is *active*.
 *
 * Keyed by the workspace *id*, not its name: the id survives a rename, which
 * is why workspaces have one.
 *
 * Opening is two-stage on purpose. The local copy paints first so the panel is
 * never blank waiting on a network round trip, and the server's copy is folded
 * in behind it. On a deployment without sync, or signed out, the second stage
 * is a no-op and this behaves exactly as it did before.
 */
export const chatThread = (): Disposable => {
  /**
   * The workspace this effect has already opened a conversation for.
   *
   * The explorer announces a switch more than once for the same workspace --
   * creating one fires on top of initialising it -- and the second pass must
   * be a no-op. `loadThread` used to provide that guard by itself, by
   * comparing thread ids; now that the id has to be looked up first, the
   * guard has to live here, ahead of the close below.
   */
  let openedFor: string | null = null;

  const open = async () => {
    const workspaceId = PgExplorer.currentWorkspaceId;
    // No workspace means nowhere to persist to. Closing rather than leaving
    // the last thread open stops it collecting messages that belong nowhere.
    if (!workspaceId) {
      openedFor = null;
      return PgAssistant.closeThread();
    }
    if (openedFor === workspaceId) return;
    openedFor = workspaceId;

    // Closed synchronously, before the index is read. Until the new thread is
    // open the panel must be pointed at no thread at all -- otherwise a
    // message sent in the gap is filed under the project the user has just
    // left. With no thread open, `loadThread` adopts it instead.
    PgAssistant.closeThread();

    // Synchronous whenever the index is already in memory, which is what
    // `warm` below is for: opening the thread in the same tick as the switch
    // is what makes a message sent straight afterwards durable.
    const id = PgThreadIndex.ensureSync(workspaceId);
    if (id === null) {
      const read = await PgThreadIndex.ensure(workspaceId);
      // The switch may have happened while the index was being read
      if (PgExplorer.currentWorkspaceId !== workspaceId) return;
      await openThread(workspaceId, read);
      return;
    }

    await openThread(workspaceId, id);
  };

  // Read the index now, so the switch that follows can open its thread in
  // one tick rather than waiting on storage
  PgThreadIndex.warm();

  /**
   * Whether anything has happened in the thread since it last reached the
   * server.
   *
   * The whole thread is uploaded each time, and the server discards ids it
   * already has, so a redundant push is harmless -- but it is a request per
   * tab-switch for every user, so it is worth not making.
   */
  let pending = false;
  const onChange = () => {
    pending = true;
  };

  /**
   * Hand the open thread over while the document is still alive.
   *
   * Project code has a debounced push *and* a reconcile that catches anything
   * the push missed. Conversations have neither: the only push outside the
   * sign-in and sign-out dumps is at the end of a turn, fire-and-forget, with
   * the result discarded. A turn that ended while the network was down, or
   * with the tab about to close, simply never reached the account -- and if
   * the user next signs out on a different device, never does.
   *
   * `visibilitychange` rather than `beforeunload`, for the same reason the
   * project flush uses it: the document is still alive here, so an ordinary
   * fetch completes, and it is the only one of the two that fires reliably on
   * mobile.
   */
  const flush = () => {
    const id = PgAssistant.threadId;
    if (!pending || !id) return;

    pending = false;
    void PgChatSync.push(id)
      .then((ok) => {
        // Put it back rather than swallowing it: the next hide tries again,
        // which is the only retry conversations have
        if (!ok) pending = true;
      })
      .catch((e) => {
        pending = true;
        report("flush thread", e);
      });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush();
  };

  void open();

  const subscriptions = [
    PgExplorer.onDidSwitchWorkspace(() => {
      // The outgoing thread's, not the incoming one's
      flush();
      void open();
    }),
    PgAssistant.onDidChange(onChange),
  ];

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flush);

  return {
    dispose: () => {
      for (const sub of subscriptions) sub.dispose();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    },
  };
};
