import { decodeThread, encodeThread } from "./chat-codec";
import { PgChatStorage } from "./chat-storage";
import { report } from "./diagnostics";
import { PgSyncClient } from "./sync-client";
import { PgThreadIndex } from "./thread-index";
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
 * What a hand-over managed.
 *
 * `pushed` is the ids the server is now known to hold, so a caller can drop
 * exactly those and no more. `complete` says whether that was all of them,
 * which is the only thing that licenses dropping the directory wholesale.
 */
export interface HandOver {
  pushed: string[];
  complete: boolean;
}

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
        `/api/conversations?threadId=${encodeURIComponent(threadId)}`,
        { credentials: "include", cache: "no-store" }
      );
      // A thread this browser started and has not pushed yet does not exist
      // on the server, and saying so is the honest answer rather than a
      // fault: there is simply nothing to merge in.
      if (response.status === 404) return null;
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

      const local = await PgChatStorage.read(threadId);
      // Nothing is written back over a thread this device could not read. The
      // merge is local-wins-by-id, so treating an unreadable file as empty
      // would replace it with the server's half -- destroying exactly the
      // messages that had not been uploaded yet. The server's copy is still
      // returned, so the panel shows what the account has.
      if (local === null) return fromServer;

      const merged = merge(fromServer, local);
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
    // "The thread is now on the server" is a claim, and the caller deletes on
    // it. It cannot be made about a thread this device could not read.
    if (items === null) return false;
    if (!items.length) return true;

    // Every thread belongs to a workspace, and the server stores the pair.
    // A thread the index has lost is one nothing can open, so pushing it
    // would only put an orphan in Postgres.
    const projectId = await PgThreadIndex.workspaceOf(threadId);
    if (!projectId) {
      report(`push ${threadId}: no workspace in the index`, null);
      return false;
    }

    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId,
          projectId,
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
   * Point a workspace at the account's conversation, when the thread this
   * device has for it is one the server has never seen.
   *
   * Sign-out clears the thread index, and a browser that has never seen the
   * account never had one -- so the next open mints a fresh thread id, and a
   * pull by that id finds nothing. The account's thread is still there, keyed
   * by a thread id only the server now knows. This asks by project instead
   * and adopts the newest thread.
   *
   * Anything already in the local thread is carried across rather than left
   * behind: it was typed on this workspace and belongs with its conversation.
   * Local wins by id, the same rule as `pull`.
   *
   * @returns the thread the workspace now points at, when that changed
   */
  static async adoptAccountThread(workspaceId: string): Promise<string | null> {
    if (!(await PgChatSync._ready())) return null;

    const local = await PgThreadIndex.get(workspaceId);

    let threads: unknown;
    try {
      const response = await fetch(
        `/api/conversations?projectId=${encodeURIComponent(workspaceId)}`,
        { credentials: "include", cache: "no-store" }
      );
      if (!response.ok) {
        report(`threads of ${workspaceId}: HTTP ${response.status}`, null);
        return null;
      }
      threads = (await response.json())?.threads;
    } catch (e) {
      report(`threads of ${workspaceId}`, e);
      return null;
    }

    // Newest first, as the server orders them
    const ids = Array.isArray(threads)
      ? threads.map((t) => t?.id).filter((id) => typeof id === "string")
      : [];
    const remote: string | undefined = ids[0];
    if (!remote || (local && ids.includes(local))) return null;

    if (local) {
      const items = await PgChatStorage.read(local);
      // Neither file is touched unless both could be read: moving what could
      // not be read would lose it, and writing over what could not be read
      // would lose that instead
      if (items === null) return null;
      if (items.length) {
        const existing = await PgChatStorage.read(remote);
        if (existing === null) return null;
        await PgChatStorage.write(remote, merge(existing, items));
      }
    }

    await PgThreadIndex.set(workspaceId, remote);
    if (local) await PgChatStorage.remove(local);
    return remote;
  }

  /**
   * `adoptAccountThread` for every workspace this device has a thread for.
   *
   * Runs at sign-in ahead of the dump. Afterwards would be too late: the dump
   * uploads a freshly minted thread as a conversation of its own, and from
   * then on the server knows it, so nothing would ever look for the older one.
   */
  static async adoptAccountThreads(): Promise<void> {
    if (!(await PgChatSync._ready())) return;

    const workspaceIds = Object.keys(await PgThreadIndex.all());
    await Promise.all(workspaceIds.map(PgChatSync.adoptAccountThread));
  }

  /**
   * Push every local thread -- the sign-in dump, and the last thing that runs
   * before sign-out clears local storage.
   *
   * @returns which threads the server now holds, or `null` when this device
   * could not enumerate its own. `null` rather than an empty result on
   * purpose: "I could not look" and "there were none" license entirely
   * different things at the other end.
   */
  static async pushAll(): Promise<HandOver | null> {
    if (!(await PgChatSync._ready())) return null;

    // The index first: it is what knows which workspace each thread belongs
    // to -- a push has to name one -- and reading it is also what gives a
    // thread file still named after its workspace an id of its own. Listing
    // the directory before that would enumerate names the rename is about to
    // invalidate.
    const indexed = Object.values(await PgThreadIndex.all());

    // And the directory as well, because it is the one that can say "I could
    // not look". Not `[].every(Boolean)`, which is `true`: without this a
    // device that could not list its own threads reported that all of them
    // had been handed over, and sign-out cleared local history on that
    // answer. The index cannot stand in for it -- an unreadable index reads
    // as an empty one.
    const stored = await PgChatStorage.threadIds();
    if (stored === null) return null;

    // A thread the index has not placed is still pushed, and still fails:
    // `push` refuses one it cannot name a workspace for, which keeps it on
    // the device rather than dropping it.
    const threadIds = [...new Set([...indexed, ...stored])];

    const outcomes = await Promise.all(
      threadIds.map(async (id) => ({ id, ok: await PgChatSync.push(id) }))
    );
    return {
      pushed: outcomes.filter((o) => o.ok).map((o) => o.id),
      complete: outcomes.every((o) => o.ok),
    };
  }

  /**
   * Hand local threads over on sign-out, then forget them.
   *
   * Registered with `PgSession` by the session effect rather than called from
   * it: `features/auth` must not import `features/persistence`, because this
   * module already imports `features/auth` and the two would be circular.
   *
   * A thread is only dropped once the server holds it. A failed push leaves
   * that thread where it is and the next sign-in tries again -- losing
   * messages to a flaky network is the worse failure, and the cost of being
   * wrong the other way is that the next user of this browser sees a thread
   * that is not theirs.
   *
   * Decided per thread, not for the set. It used to be all-or-nothing, and
   * that got both halves of the trade wrong at once: one thread failing to
   * upload kept every *other* thread on the device too -- including ones the
   * account demonstrably already held, which had nothing left to lose -- so a
   * single flaky request handed the next user the entire transcript. Nothing
   * was gained for it: the failed thread is kept either way.
   */
  static async handOver(): Promise<void> {
    const handed = await PgChatSync.pushAll();
    if (!handed) return;

    // Wholesale when everything made it, because that is the one case where
    // dropping the directory itself is provably safe -- and it takes with it
    // anything `threadIds` does not enumerate, which a file-by-file delete
    // would leave behind for the next account to inherit.
    if (handed.complete) {
      await PgChatStorage.clear();
      // The directory went with it, but the index also caches that migration
      // has run -- and for the next user of this browser it has not.
      await PgThreadIndex.clear();
      return;
    }

    // Partial: the index keeps pointing at the threads that stayed, and at
    // the ones just removed. A stale entry costs an empty thread on the next
    // open, which `PgChatStorage.read` answers with `[]` -- not the wrong
    // account's messages, which is what this is protecting.
    await Promise.all(handed.pushed.map((id) => PgChatStorage.remove(id)));
  }

  private static async _ready() {
    return !!PgSession.get() && (await PgSyncClient.available());
  }
}
