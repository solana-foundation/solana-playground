import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { PgAssistant } from "../../views/sidebar/assistant/store";

/**
 * Open a workspace's thread: the local copy first, the server's folded in.
 *
 * When the server has never heard of this thread id, the account may still
 * hold the workspace's conversation under another -- sign-out clears the
 * thread index, so the next open mints a fresh id. `adoptAccountThread` finds
 * it by project, and the panel moves over to it.
 *
 * Shared with the session effect, which repoints threads at sign-in and has
 * to move the panel with them. Its own file, outside the `index.ts` barrel:
 * every export there is mounted as an effect.
 */
export const openThread = async (workspaceId: string, id: string) => {
  await PgAssistant.loadThread(id);

  const merged = await PgChatSync.pull(id);
  // `pull` rewrote storage underneath, so the open thread has to be re-read
  // past `loadThread`'s unchanged-id guard -- but only if the user has not
  // switched away while the request was in flight.
  if (merged) {
    if (PgAssistant.threadId === id) await PgAssistant.loadThread(id, true);
    return;
  }

  const adopted = await PgChatSync.adoptAccountThread(workspaceId);
  if (!adopted || PgAssistant.threadId !== id) return;

  await PgAssistant.loadThread(adopted);
  if ((await PgChatSync.pull(adopted)) && PgAssistant.threadId === adopted) {
    await PgAssistant.loadThread(adopted, true);
  }
};
