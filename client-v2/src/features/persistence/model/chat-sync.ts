import { decodeThread, encodeThread } from "./chat-codec";
import { PgChatStorage } from "./chat-storage";
import { report } from "./diagnostics";
import { PgSyncClient } from "./sync-client";
import { PgSession } from "../../auth";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/** Oldest first, ties broken by id so two devices agree on the order */
const byTime = (a: ChatItem, b: ChatItem) =>
  a.createdAt === b.createdAt
    ? a.id.localeCompare(b.id)
    : a.createdAt.localeCompare(b.createdAt);

/**
 * Union by id.
 *
 * Local is applied second, so a message the client has edited since uploading
 * wins over the server's copy. Ids are minted on the client, which is what
 * makes "the same message" answerable without asking the server.
 */
const merge = (server: ChatItem[], local: ChatItem[]) => {
  const byId = new Map<string, ChatItem>();
  for (const item of [...server, ...local]) byId.set(item.id, item);
  return [...byId.values()].sort(byTime);
};

/**
 * Mirror local threads to Postgres.
 *
 * Push is append-only and every id is minted on the client, so it is safe to
 * repeat: signing in on a third device, or retrying after a failure, writes
 * only what is genuinely new.
 */
export class PgChatSync {
  /** @returns the merged thread, or `null` when sync is unavailable */
  static async pull(threadId: string): Promise<ChatItem[] | null> {
    if (!(await PgChatSync._ready())) return null;

    try {
      const response = await fetch(
        `/api/conversations?projectId=${encodeURIComponent(threadId)}`,
        { credentials: "include", cache: "no-store" }
      );
      if (!response.ok) {
        report(`pull ${threadId}: HTTP ${response.status}`, null);
        return null;
      }

      const body = await response.json();
      const fromServer = decodeThread(body?.items);

      // The server's own count, before decoding. A message that reached
      // Postgres and then failed to decode here is invisible everywhere else:
      // the thread simply looks shorter than it is.
      const offered = Array.isArray(body?.items) ? body.items.length : 0;
      if (fromServer.length < offered) {
        report(
          `pull ${threadId}: dropped ${
            offered - fromServer.length
          } of ${offered} server item(s) as unreadable`,
          null
        );
      }

      const merged = merge(fromServer, await PgChatStorage.read(threadId));
      await PgChatStorage.write(threadId, merged);
      return merged;
    } catch (e) {
      report(`pull ${threadId}`, e);
      return null;
    }
  }

  /** @returns whether the thread is now on the server */
  static async push(threadId: string): Promise<boolean> {
    if (!(await PgChatSync._ready())) return false;

    const items = await PgChatStorage.read(threadId);
    if (!items.length) return true;

    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: threadId,
          items: encodeThread(items),
        }),
      });
      if (!response.ok)
        report(`push ${threadId}: HTTP ${response.status}`, null);
      return response.ok;
    } catch (e) {
      report(`push ${threadId}`, e);
      return false;
    }
  }

  /**
   * Push every local thread -- the sign-in dump, and the last thing that runs
   * before sign-out clears local storage.
   *
   * @returns whether everything made it. `false` means keep the local copy.
   */
  static async pushAll(): Promise<boolean> {
    if (!(await PgChatSync._ready())) return false;

    const threadIds = await PgChatStorage.threadIds();
    const results = await Promise.all(
      threadIds.map((id) => PgChatSync.push(id))
    );
    return results.every(Boolean);
  }

  /**
   * Hand local threads over on sign-out, then forget them.
   *
   * Registered with `PgSession` by the session effect rather than called from
   * it: `features/auth` must not import `features/persistence`, because this
   * module already imports `features/auth` and the two would be circular.
   *
   * Local storage is only cleared once everything is safely on the server. A
   * failed push leaves the thread where it is and the next sign-in tries
   * again -- losing messages to a flaky network is the worse failure, and the
   * cost of being wrong the other way is that the next user of this browser
   * briefly sees threads that are not theirs.
   */
  static async handOver(): Promise<void> {
    if (await PgChatSync.pushAll()) await PgChatStorage.clear();
  }

  private static async _ready() {
    return !!PgSession.get() && (await PgSyncClient.available());
  }
}
