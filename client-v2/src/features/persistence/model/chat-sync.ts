import { decodeThread, encodeThread, mergeThreads } from "./chat-codec";
import { PgChatStorage, withoutTruncationNotice } from "./chat-storage";
import { DELETED_REASON, isDeletedScope } from "./deleted.mjs";
import { report } from "./diagnostics";
import { PgSyncClient } from "./sync-client";
import { PgThreadIndex } from "./thread-index";
import { PgSession } from "../../auth";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/**
 * What a hand-over managed.
 *
 * `handedOver` is the ids this device may drop: the server holds them, or
 * has closed them under a project it still has. `complete` says whether that was
 * all of them, which is the only thing that licenses dropping the directory
 * wholesale.
 */
export interface HandOver {
  handedOver: string[];
  complete: boolean;
}

/**
 * How a push ended.
 *
 * - `pushed`: the server holds the thread.
 * - `thread-deleted`: the server has tombstoned this thread and will not take
 *   it again, while its project is live -- a tutorial started again on
 *   another device. The caller replaces the thread.
 * - `project-deleted`: the thread's project is tombstoned, so no thread
 *   under it can be pushed. The caller leaves it for the user's answer about
 *   the project (`SyncBanner`): "keep as new" carries the conversation,
 *   "delete" drops it.
 * - `failed`: nothing is known; the thread stays and is tried again.
 *
 * Neither deletion is `failed`: a failed thread is tried again on every
 * turn, and a tombstone never lifts.
 */
export type PushOutcome =
  | "pushed"
  | "thread-deleted"
  | "project-deleted"
  | "failed";

/**
 * Whether this device may drop its copy after the push.
 *
 * Named positively, so an outcome added later has to opt in to deletion.
 * `project-deleted` is not in it: that thread is waiting for the user's
 * answer about the project, and `releaseLocalProjects` keeps the project
 * for the same answer -- the two hand-overs have to make the same trade.
 */
export const isHandedOver = (outcome: PushOutcome) =>
  outcome === "pushed" || outcome === "thread-deleted";

/**
 * Mirror local threads to Postgres.
 *
 * Every id is minted on the client and the server keeps the newer copy of
 * each, so a push is safe to repeat: signing in on a third device, or
 * retrying after a failure, writes only what is new or has changed since.
 */
export class PgChatSync {
  /**
   * Merge the server's copy of a thread into the stored one, newest copy of
   * each item winning and local on a tie.
   *
   * Only for a thread the panel does not have open. For the open one, storage
   * lags memory -- the store's writes are queued on its own chain, which this
   * read and write are not on -- so writing a merge of the stored copy back
   * can drop an item the panel added a moment ago. That one goes to
   * `PgAssistant.foldIn` instead; `openThread` decides which.
   *
   * @returns the merged thread, or the server's copy alone when the stored one
   * could not be read
   */
  static async storeMerged(
    threadId: string,
    fromServer: ChatItem[]
  ): Promise<ChatItem[]> {
    // No `try` of its own: `PgChatStorage` reports and swallows its failures,
    // answering `null` for a read that failed
    const local = await PgChatStorage.read(threadId);
    // Nothing is written back over a thread this device could not read. The
    // merge is a union by id, so treating an unreadable file as empty would
    // replace it with the server's half -- destroying exactly the messages
    // that had not been uploaded yet. The server's copy is still returned, so
    // the panel shows what the account has.
    if (local === null) return fromServer;

    const merged = mergeThreads(fromServer, local);
    await PgChatStorage.write(threadId, merged);
    return merged;
  }

  /**
   * The server's copy of a thread, without touching storage.
   *
   * @returns the thread's items; **`"missing"`** when the server has never
   * seen the thread; or `null` when sync is unavailable or the request
   * failed. The last two are kept apart because a caller acts on the second:
   * a thread the server lacks is a reason to go looking for the account's
   * own, and a failed request is not -- adopting on it reloaded the open
   * thread mid-turn, denying the card the user had not answered.
   */
  static async fetchThread(
    threadId: string
  ): Promise<ChatItem[] | "missing" | null> {
    if (!(await PgChatSync._ready())) return null;

    try {
      const response = await fetch(
        `/api/conversations?threadId=${encodeURIComponent(threadId)}`,
        { credentials: "include", cache: "no-store" }
      );
      // A thread this browser started and has not pushed yet does not exist
      // on the server, and saying so is the honest answer rather than a
      // fault: there is simply nothing to merge in.
      if (response.status === 404) return "missing";
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

      return fromServer;
    } catch (e) {
      report(`pull ${threadId}`, e);
      return null;
    }
  }

  /** @returns how the push ended -- see `PushOutcome` */
  static async push(threadId: string): Promise<PushOutcome> {
    if (!(await PgChatSync._ready())) return "failed";

    const items = await PgChatStorage.read(threadId);
    // "The thread is now on the server" is a claim, and the caller deletes on
    // it. It cannot be made about a thread this device could not read.
    if (items === null) return "failed";
    if (!items.length) return "pushed";

    // Every thread belongs to a workspace, and the server stores the pair.
    // A thread the index has lost is one nothing can open, so pushing it
    // would only put an orphan in Postgres.
    const projectId = await PgThreadIndex.workspaceOf(threadId);
    if (!projectId) {
      report(`push ${threadId}: no workspace in the index`, null);
      return "failed";
    }

    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId,
          projectId,
          // The truncation notice is this device's own bookkeeping. The
          // server keeps every message, so uploading it would tell the next
          // device that history it can still read is gone.
          items: encodeThread(withoutTruncationNotice(items)),
        }),
      });
      if (response.ok) return "pushed";
      // Not a failure: the server has decided about this thread, and the
      // body says which tombstone it hit. Reported anyway, so the console
      // says why a thread stopped syncing.
      if (response.status === 410) {
        const scope = await PgChatSync._deletedScope(response);
        if (scope === "unknown") {
          report(`push ${threadId}: unrecognised HTTP 410`, null);
          return "failed";
        }
        report(`push ${threadId}: ${scope} deleted on the server`, null);
        return scope === "project" ? "project-deleted" : "thread-deleted";
      }
      report(`push ${threadId}: HTTP ${response.status}`, null);
      return "failed";
    } catch (e) {
      report(`push ${threadId}`, e);
      return "failed";
    }
  }

  /**
   * Which tombstone a 410 names.
   *
   * Only our own 410 counts: the body has to carry `reason: "deleted"` and a
   * scope, as `api/conversations.mjs` sends them. Anything else -- a body
   * that cannot be read, a platform's or a proxy's 410 page -- is `unknown`,
   * and the push counts as failed: nothing is known, so nothing may be
   * dropped. The caller acts on `thread` by forgetting the conversation, and
   * a status alone must not be what decides that.
   */
  private static async _deletedScope(
    response: Response
  ): Promise<"project" | "thread" | "unknown"> {
    let body: { reason?: unknown; scope?: unknown } | null = null;
    try {
      body = await response.json();
    } catch (e) {
      report("read 410 body", e);
      return "unknown";
    }
    if (body?.reason !== DELETED_REASON) return "unknown";
    return isDeletedScope(body.scope) ? body.scope : "unknown";
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
   * The newer copy of an id wins, local on a tie -- `mergeThreads`' rule.
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
        await PgChatStorage.write(remote, mergeThreads(existing, items));
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
   * @returns which threads this device may drop -- the server holds them, or
   * has closed them under a live project -- or `null` when this device
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

    // A thread the server has closed under a live project counts as handed
    // over: it will never take it again, and keeping the file for the next
    // user of this browser protects nothing. One under a deleted project
    // stays, like the project it belongs to -- see `isHandedOver`.
    const outcomes = await Promise.all(
      threadIds.map(async (id) => ({
        id,
        handedOver: isHandedOver(await PgChatSync.push(id)),
      }))
    );
    return {
      handedOver: outcomes.filter((o) => o.handedOver).map((o) => o.id),
      complete: outcomes.every((o) => o.handedOver),
    };
  }

  /**
   * Hand local threads over on sign-out, then forget them.
   *
   * Registered with `PgSession` by the session effect rather than called from
   * it: `features/auth` must not import `features/persistence`, because this
   * module already imports `features/auth` and the two would be circular.
   *
   * A thread is only dropped once the server holds it, or has closed it
   * under a project it still has (`isHandedOver`). A failed push leaves
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
    await Promise.all(handed.handedOver.map((id) => PgChatStorage.remove(id)));
  }

  private static async _ready() {
    return !!PgSession.get() && (await PgSyncClient.available());
  }
}
