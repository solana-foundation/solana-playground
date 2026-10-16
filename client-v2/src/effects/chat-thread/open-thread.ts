import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { PgAssistant } from "../../views/sidebar/assistant/store";
import type { ChatItem } from "../../views/sidebar/assistant/store";

/**
 * Open a workspace's thread: the local copy first, the server's folded in.
 *
 * When the server has never heard of this thread id, the account may still
 * hold the workspace's conversation under another -- sign-out clears the
 * thread index, so the next open mints a fresh id. `adoptAccountThread` finds
 * it by project, and the panel moves over to it.
 *
 * Shared with the session effect, which repoints threads at sign-in and has
 * to move the panel with them -- and which calls this for a thread that is
 * already open, possibly in the middle of a turn. `loadThread` is a no-op for
 * an open id, and the server's copy is folded into memory rather than the
 * thread being force-reloaded from storage, so a running turn keeps its
 * status, its unanswered approval and everything it has written since. Its
 * own file, outside the `index.ts` barrel: every export there is mounted as
 * an effect.
 */
export const openThread = async (workspaceId: string, id: string) => {
  await PgAssistant.loadThread(id);

  const fromServer = await PgChatSync.fetchThread(id);
  if (Array.isArray(fromServer)) {
    await settleInto(id, fromServer);
    return;
  }
  // Only a thread the server answered for as missing is a reason to look for
  // the account's. A failed request says nothing about that, and adopting
  // reloads the panel -- mid-turn, too, since the session effect calls this
  // for a thread that is already open.
  if (fromServer !== "missing") return;

  const adopted = await PgChatSync.adoptAccountThread(workspaceId);
  if (!adopted || PgAssistant.threadId !== id) return;

  await PgAssistant.loadThread(adopted);
  const adoptedItems = await PgChatSync.fetchThread(adopted);
  if (Array.isArray(adoptedItems)) await settleInto(adopted, adoptedItems);
};

/**
 * Put a thread's server copy where it belongs: into memory when the panel
 * still has it open, which then persists it on the store's own write chain,
 * or into storage when the user has switched away while the request was out.
 *
 * Whether it is open is asked again after every wait, because the user can
 * switch back during one. Written to storage then, the merge lands under a
 * panel that has already read the file without it, and the next message the
 * panel persists writes the pre-merge copy back over it.
 */
const settleInto = async (id: string, fromServer: ChatItem[]) => {
  if (await PgAssistant.foldIn(id, fromServer)) return;

  // The thread just left may still have its last write queued on the store's
  // chain. Merging into storage before it lands would read the file without
  // that message and write it back the same way.
  await PgAssistant.whenPersisted();
  if (await PgAssistant.foldIn(id, fromServer)) return;

  await PgChatSync.storeMerged(id, fromServer);
  // Reopened while the merge was being written: its read may have beaten
  // the write. Folding in again is a no-op when it did not.
  await PgAssistant.foldIn(id, fromServer);
};
