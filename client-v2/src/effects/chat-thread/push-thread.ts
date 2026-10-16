import { PgChatSync } from "../../features/persistence/model/chat-sync";
import { report } from "../../features/persistence/model/diagnostics";
import { PgThreadIndex } from "../../features/persistence/model/thread-index";
import { PgAssistant } from "../../views/sidebar/assistant/store";
import { PgExplorer } from "../../utils/explorer/explorer";
import { openThread } from "./open-thread";

/**
 * Upload a thread once the store's last write to it has landed.
 *
 * `push` reads the thread from storage, and the store's writes are fired and
 * forgotten, so the one the final streamed delta queued may still be in
 * flight. Pushing straight away uploaded the reply short of it. Ordinarily the
 * write has long landed and the wait costs a microtask.
 *
 * Shared by the end-of-turn push in `Chat` and the chat effect's flush. Its
 * own file, outside the `index.ts` barrel: every export there is mounted as
 * an effect.
 *
 * A thread the server has deleted is not pushed again as though the push
 * had merely failed:
 *
 * - deleted under a live project -- a tutorial started again on another
 *   device -- it is forgotten and, if the panel has it open, replaced by a
 *   fresh thread for the workspace, which then adopts the account's;
 * - deleted with its project, it is left alone and stays owed. The user is
 *   about to be asked about the project (`SyncBanner`), and the answer
 *   settles the chat too: "keep as new" carries it, "delete" drops it.
 *   Forgetting it here would lose the conversation before that question is
 *   on screen. Owed rather than settled because the tombstone may not
 *   last: a tutorial restarted on this device revives its project with the
 *   project push, and the thread then has to follow it.
 *
 * @returns whether the thread is settled: on the server, or closed by it
 * and forgotten here. `false` means it is still owed and the caller should
 * try again.
 */
export const pushThread = async (threadId: string): Promise<boolean> => {
  await PgAssistant.whenPersisted();
  const outcome = await PgChatSync.push(threadId);
  switch (outcome) {
    case "pushed":
      return true;
    case "thread-deleted":
      return replaceDeleted(threadId);
    case "project-deleted":
    case "failed":
      return false;
  }
};

/**
 * Forget a thread the server has closed, and open a new one in its place.
 *
 * The panel leaves the dead thread before its file goes, and waits for the
 * store's last write to it: a message sent while `forget` waits on the lock
 * was written into the file `forget` then deleted, and vanished with the
 * reply streaming after it. Typed while no thread is open, it is adopted by
 * the next one (`PgAssistant.loadThread`).
 *
 * @returns whether the thread is forgotten
 */
const replaceDeleted = async (threadId: string): Promise<boolean> => {
  const workspaceId = await PgThreadIndex.workspaceOf(threadId);
  if (!workspaceId) return true;

  // Only when the panel is still showing the dead thread on the workspace
  // it belongs to. Switched away, the next open mints a fresh one anyway.
  const showing =
    PgAssistant.threadId === threadId &&
    PgExplorer.currentWorkspaceId === workspaceId;
  if (showing) PgAssistant.closeThread();
  await PgAssistant.whenPersisted();

  const forgotten = await PgThreadIndex.forget(workspaceId);
  if (!showing) return forgotten;

  // Not forgotten, the same thread opens again, which is still better than
  // a panel with nothing open; it is pushed again on the next turn
  try {
    await openThread(workspaceId, await PgThreadIndex.ensure(workspaceId));
  } catch (e) {
    report(`reopen ${workspaceId} after its thread was deleted`, e);
  }
  return forgotten;
};
