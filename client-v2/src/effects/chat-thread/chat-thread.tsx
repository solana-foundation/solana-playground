import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { PgAssistant } from "../../views/sidebar/assistant/store";
import { PgExplorer } from "../../utils";
import type { Disposable } from "../../utils/types";

/**
 * Keep the open conversation pointed at the current workspace.
 *
 * An app-level effect rather than something the assistant panel does, because
 * the panel is not always mounted -- it can be collapsed, or showing the
 * backend picker -- and which conversation is open must not depend on whether
 * anyone is looking at it. Otherwise a message sent right after a project
 * switch lands in the previous project's thread, or in none at all.
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
  const open = async () => {
    const id = PgExplorer.currentWorkspaceId;
    // No workspace means nowhere to persist to. Closing rather than leaving
    // the last thread open stops it collecting messages that belong nowhere.
    if (!id) return PgAssistant.closeThread();

    await PgAssistant.loadThread(id);

    const merged = await PgChatSync.pull(id);
    // `pull` rewrote storage underneath, so the open thread has to be re-read
    // past `loadThread`'s unchanged-id guard -- but only if the user has not
    // switched away while the request was in flight.
    if (merged && PgAssistant.threadId === id) {
      await PgAssistant.loadThread(id, true);
    }
  };

  void open();
  return PgExplorer.onDidSwitchWorkspace(() => void open());
};
