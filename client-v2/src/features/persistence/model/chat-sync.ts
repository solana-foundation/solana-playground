import { decodeThread, encodeThread, mergeThreads } from "./chat-codec";
import { PgChatStorage, withoutTruncationNotice } from "./chat-storage";
import { DELETED_REASON, isDeletedScope } from "./deleted.mjs";
import { report } from "./diagnostics";
import { sha256 } from "./snapshot";
import { PgSyncClient } from "./sync-client";
import { PgThreadIndex } from "./thread-index";
// TODO(ui-migration 1.4): a feature importing a feature; chat sync runs only for a signed-in session
import { PgSession } from "@/features/auth";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/**
 * What a hand-over managed.
 *
 * `handedOver` is the threads this device may drop: the server holds them, or
 * has closed them under a project it still has. Each carries a hash of the
 * copy read before its push, because a sign-out drops them only after its
 * request: a thread written to in between holds something the server never
 * took. `complete` says whether that was all of them, which is the only thing
 * that licenses dropping the directory wholesale.
 */
export interface HandOver {
  handedOver: HandedThread[];
  complete: boolean;
}

/** A thread the server took, and the hash of the copy it was pushed from */
interface HandedThread {
  id: string;
  hash: string;
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
   * Push every local thread: the sign-in dump, and a sign-out's upload half,
   * whose result goes to `forget` once the server has ended the session.
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
    //
    // Hashed before the push reads it, so a write landing in between leaves
    // the stored copy newer than the hash, and `forget` keeps it.
    const outcomes = await Promise.all(
      threadIds.map(async (id) => {
        const hash = await PgChatSync._hashOf(id);
        const handedOver = isHandedOver(await PgChatSync.push(id));
        return hash !== null && handedOver ? { id, hash } : null;
      })
    );
    const handedOver = outcomes.filter((o): o is HandedThread => o !== null);
    return {
      handedOver,
      complete: handedOver.length === threadIds.length,
    };
  }

  /**
   * Forget the threads a sign-out's `pushAll` handed over.
   *
   * Separate from the push because a sign-out spans both: the push runs while
   * the request is still authenticated, and this only once the server has
   * ended the session. A sign-out that fails leaves the user signed in, with
   * every thread still on the device.
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
   *
   * And only while it still holds what was pushed. The sign-out request runs
   * between the push and this, with the panel still open: a reply finishing
   * or a message sent in that window was written after the push, and dropping
   * the thread deleted it unsent.
   */
  static async forget(handed: HandOver | null): Promise<void> {
    if (!handed) return;

    const unchanged = (
      await Promise.all(
        handed.handedOver.map(async ({ id, hash }) =>
          (await PgChatSync._hashOf(id)) === hash ? id : null
        )
      )
    ).filter((id): id is string => id !== null);

    // Wholesale when everything made it and nothing has been written since,
    // because that is the one case where dropping the directory itself is
    // provably safe -- and it takes with it anything `threadIds` does not
    // enumerate, which a file-by-file delete would leave behind for the next
    // account to inherit. A thread that appeared since was never pushed.
    const stored = await PgChatStorage.threadIds();
    const untouched =
      handed.complete &&
      unchanged.length === handed.handedOver.length &&
      stored !== null &&
      stored.every((id) => unchanged.includes(id));
    if (untouched) {
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
    await Promise.all(unchanged.map((id) => PgChatStorage.remove(id)));
  }

  /** A hash of the stored thread, or `null` when it cannot be read */
  private static async _hashOf(threadId: string): Promise<string | null> {
    const items = await PgChatStorage.read(threadId);
    return items === null ? null : sha256(JSON.stringify(items));
  }

  /** Not while a sign-out tears down: the cookie is gone, see `PgSession.isEnding` */
  private static async _ready() {
    return (
      !!PgSession.get() &&
      !PgSession.isEnding &&
      (await PgSyncClient.available())
    );
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;
  type Mock = import("vitest").Mock;
  type BackendParams =
    import("../../../views/sidebar/assistant/store").BackendParams;
  describe("features/persistence/model/chat-sync", () => {
    let uuid: typeof import("@/shared/lib/ids").uuid;
    let PgFs: typeof import("../../../utils/explorer/fs").PgFs;
    beforeAll(async () => {
      ({ uuid } = await import("@/shared/lib/ids"));
      ({ PgFs } = await import("../../../utils/explorer/fs"));
    });
    /**
     * A minted id, but the same one every time a key is asked for.
     *
     * The merge test writes `item(2)` locally and has the server answer with
     * `item(2)` as well, and proves the pull does not duplicate it -- which only
     * means anything while the two share an id. So the ids are real uuids rather
     * than hand-written strings, and stable rather than fresh per call.
     */
    const minted = new Map<string, string>();
    const idOf = (key: string): string => {
      const known = minted.get(key);
      if (known) return known;

      const fresh = uuid();
      minted.set(key, fresh);
      return fresh;
    };

    const item = (n: number): ChatItem => ({
      kind: "user",
      id: idOf(`item:${n}`),
      createdAt: new Date(n * 1000).toISOString(),
      text: `m${n}`,
    });

    const reply = (n: number, origin?: BackendParams): ChatItem => ({
      kind: "assistant",
      id: idOf(`reply:${n}`),
      createdAt: new Date(n * 1000).toISOString(),
      text: `r${n}`,
      ...(origin ? { origin } : {}),
    });

    /**
     * Fetch the server's copy and merge it into storage: what `openThread` does
     * for a thread the panel does not have open.
     *
     * @returns the merged thread, or `null` when there was nothing to merge
     */
    const pull = async (threadId: string) => {
      const fromServer = await PgChatSync.fetchThread(threadId);
      if (!Array.isArray(fromServer)) return null;
      return await PgChatSync.storeMerged(threadId, fromServer);
    };

    /** Only `id` matters to sync; the rest of the session user is display */
    const signedIn = () =>
      PgSession.refreshWith({ id: "u1", name: null, image: null, login: null });

    /**
     * The spy standing in for `fetch`, reinstalled for each test.
     *
     * `vi.spyOn` rather than assigning `global.fetch`: `restoreAllMocks` then
     * puts the global back afterwards, so a stub one test installed cannot answer
     * the next one's request. The stand-in it replaces comes from
     * `setupTests.ts`, which throws, so an unstubbed request fails loudly.
     */
    let fetchMock: Mock;

    beforeEach(() => {
      fetchMock = vi.spyOn(globalThis, "fetch") as unknown as Mock;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** `/api/sync` says yes; everything else is the caller's to describe */
    const respondingWith = (rest: (url: string) => unknown) =>
      fetchMock.mockImplementation((url: string) =>
        url === "/api/sync"
          ? Promise.resolve({
              ok: true,
              json: async () => ({ enabled: true, db: "ok" }),
            })
          : rest(url)
      );

    /** The body of the one POST that was made */
    const postedBody = () => {
      const call = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "POST"
      );
      return JSON.parse(call![1].body);
    };

    describe("PgChatSync", () => {
      /** A workspace with a thread on it, which is what push needs to name one */
      let threadId: string;

      beforeEach(async () => {
        await PgChatStorage.clear();
        await PgThreadIndex.clear();
        PgSession.reset();
        PgSyncClient.reset();
        threadId = await PgThreadIndex.ensure("w1");
      });

      it("does nothing when signed out", async () => {
        await PgChatStorage.write(threadId, [item(1)]);

        await PgChatSync.push(threadId);

        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("posts the local thread when signed in", async () => {
        respondingWith(() =>
          Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
        );
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        await PgChatSync.push(threadId);

        expect(fetchMock).toHaveBeenCalledWith(
          "/api/conversations",
          expect.objectContaining({ method: "POST" })
        );
      });

      it("names the thread and its workspace, so the server can key both", async () => {
        respondingWith(() =>
          Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
        );
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        await PgChatSync.push(threadId);

        expect(postedBody()).toMatchObject({ threadId, projectId: "w1" });
      });

      it("never sends the API key, under any name", async () => {
        respondingWith(() =>
          Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
        );
        await signedIn();
        await PgChatStorage.write(threadId, [
          item(1),
          reply(2, { provider: "anthropic", model: "claude-opus-5" }),
        ]);

        await PgChatSync.push(threadId);

        const body = postedBody();
        // The backend a reply came from rides along, inside the message that
        // produced it -- the thread itself records no backend at all
        expect(body.items[1].origin).toEqual({
          provider: "anthropic",
          model: "claude-opus-5",
        });
        expect(JSON.stringify(body)).not.toMatch(/apiKey|"key"|token|sk-/);
      });

      it("refuses to push a thread the index cannot place", async () => {
        respondingWith(() =>
          Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
        );
        await signedIn();
        const unknown = uuid();
        await PgChatStorage.write(unknown, [item(1)]);

        const outcome = await PgChatSync.push(unknown);

        expect(outcome).toBe("failed");
      });

      describe("a thread the server has deleted", () => {
        const refusedWith = (json: () => Promise<unknown>) =>
          respondingWith(() =>
            Promise.resolve({ ok: false, status: 410, json })
          );

        // A 410 used to be `!ok`, so a thread deleted with its project was
        // pushed and refused again on every turn. Only our own body counts:
        // `thread-deleted` is acted on by forgetting the conversation, so a
        // proxy's error page, a platform's 410 for a deleted deployment, or a
        // body that names no tombstone must not read as one.
        const cases: {
          body: string;
          json: () => Promise<unknown>;
          outcome: PushOutcome;
        }[] = [
          {
            body: "names the thread",
            json: async () => ({ reason: "deleted", scope: "thread" }),
            outcome: "thread-deleted",
          },
          {
            body: "names the project",
            json: async () => ({ reason: "deleted", scope: "project" }),
            outcome: "project-deleted",
          },
          {
            body: "names no scope",
            json: async () => ({ reason: "deleted" }),
            outcome: "failed",
          },
          {
            body: "names a scope it does not know",
            json: async () => ({ reason: "deleted", scope: "account" }),
            outcome: "failed",
          },
          {
            body: "is not ours",
            json: async () => ({
              error: "DEPLOYMENT_DELETED",
              scope: "thread",
            }),
            outcome: "failed",
          },
          {
            body: "cannot be read",
            json: async () => {
              throw new Error("not json");
            },
            outcome: "failed",
          },
        ];
        cases.forEach(({ body, json, outcome }) => {
          it(`reads a 410 whose body ${body} as ${outcome}`, async () => {
            refusedWith(json);
            await signedIn();
            await PgChatStorage.write(threadId, [item(1)]);

            expect(await PgChatSync.push(threadId)).toBe(outcome);
          });
        });
      });

      it("keeps the local thread when the push fails, so nothing is lost", async () => {
        respondingWith(() => Promise.reject(new Error("offline")));
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        const handed = await PgChatSync.pushAll();

        expect(handed).toEqual({ handedOver: [], complete: false });
        expect(await PgChatStorage.read(threadId)).toHaveLength(1);
      });

      it("merges the server thread with local items on pull, without duplicates", async () => {
        respondingWith(() =>
          Promise.resolve({
            ok: true,
            json: async () => ({ items: [item(1), item(2)] }),
          })
        );
        await signedIn();
        await PgChatStorage.write(threadId, [item(2), item(3)]);

        const merged = await pull(threadId);

        expect(merged!.map((i) => (i as { text: string }).text)).toEqual([
          "m1",
          "m2",
          "m3",
        ]);
      });

      describe("when both copies hold the same message", () => {
        /** `reply(1)` as it stood at second `at`, holding `text` */
        const replyAt = (text: string, at?: number): ChatItem => ({
          kind: "assistant",
          id: reply(1).id,
          createdAt: reply(1).createdAt,
          text,
          ...(at ? { updatedAt: new Date(at * 1000).toISOString() } : {}),
        });

        const pulled = async (server: ChatItem, local: ChatItem) => {
          respondingWith(() =>
            Promise.resolve({
              ok: true,
              json: async () => ({ items: [server] }),
            })
          );
          await signedIn();
          await PgChatStorage.write(threadId, [local]);

          const merged = await pull(threadId);
          // And what was written back, which is what the panel reloads from
          expect(await PgChatStorage.read(threadId)).toEqual(merged);
          return (merged![0] as { text: string }).text;
        };

        it("takes the server's when it is newer", async () => {
          // This device pulled a reply mid-stream; the device that ran the turn
          // has since pushed the finished one
          expect(await pulled(replyAt("Done.", 5), replyAt("Do", 2))).toBe(
            "Done."
          );
        });

        it("takes the server's over a local copy that was never changed", async () => {
          // Old data and a fresh item carry no `updatedAt`; their version is
          // `createdAt`, which every later change is stamped after
          expect(await pulled(replyAt("Done.", 5), replyAt(""))).toBe("Done.");
        });

        it("keeps the local copy when it is newer", async () => {
          expect(await pulled(replyAt("Do", 2), replyAt("Done.", 5))).toBe(
            "Done."
          );
        });

        it("keeps the local copy on a tie", async () => {
          expect(await pulled(replyAt("server", 5), replyAt("local", 5))).toBe(
            "local"
          );
        });
      });

      it("pulls by thread id, not by workspace", async () => {
        respondingWith(() =>
          Promise.resolve({ ok: true, json: async () => ({ items: [] }) })
        );
        await signedIn();

        await pull(threadId);

        expect(fetchMock).toHaveBeenCalledWith(
          `/api/conversations?threadId=${threadId}`,
          expect.anything()
        );
      });

      it("treats a thread the server has never seen as nothing to merge", async () => {
        respondingWith(() =>
          Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
        );
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);
        PgChatStorage.clearLastFailure();

        expect(await PgChatSync.fetchThread(threadId)).toBe("missing");
        expect(await pull(threadId)).toBeNull();
        expect(await PgChatStorage.read(threadId)).toHaveLength(1);
        // Not a fault: a thread that has never been pushed is simply not there
        expect(PgChatStorage.lastFailure).toBeNull();
      });

      it("leaves the local thread alone when the server cannot be reached", async () => {
        respondingWith(() => Promise.reject(new Error("offline")));
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        // Not "missing": a request that failed says nothing about whether the
        // server has the thread, and `openThread` adopts only on the latter
        expect(await PgChatSync.fetchThread(threadId)).toBeNull();
        expect(await pull(threadId)).toBeNull();
        expect(await PgChatStorage.read(threadId)).toHaveLength(1);
      });

      it("stays local when the deployment has no database", async () => {
        fetchMock.mockImplementation((url: string) =>
          url === "/api/sync"
            ? Promise.resolve({
                ok: true,
                json: async () => ({ enabled: false, db: "unconfigured" }),
              })
            : Promise.reject(new Error("should not be called"))
        );
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        expect(await PgChatSync.push(threadId)).toBe("failed");
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    describe("handing conversations over at sign-out", () => {
      let mockFiles: Map<string, string>;
      beforeAll(() => {
        mockFiles = (PgFs as unknown as { __files: Map<string, string> })
          .__files;
      });

      const accepted = () =>
        respondingWith(() =>
          Promise.resolve({ ok: true, json: async () => ({ written: 1 }) })
        );

      /** A thread the index can place, which is what `push` needs */
      let threadId: string;

      beforeEach(async () => {
        await PgChatStorage.clear();
        await PgThreadIndex.clear();
        PgSession.reset();
        PgSyncClient.reset();
        threadId = await PgThreadIndex.ensure("w1");
      });

      it("clears local threads once the server has them", async () => {
        accepted();
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        await PgChatSync.forget(await PgChatSync.pushAll());

        expect(await PgChatStorage.threadIds()).toEqual([]);
      });

      it("keeps them when a push failed", async () => {
        respondingWith(() =>
          Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
        );
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        await PgChatSync.forget(await PgChatSync.pushAll());

        expect(await PgChatStorage.read(threadId)).toHaveLength(1);
      });

      it("drops the threads the server took and keeps only the one that failed", async () => {
        // This used to be all-or-nothing. One thread failing to upload kept every
        // other thread on the device as well -- including ones the account
        // demonstrably already held -- so a single flaky request handed the next
        // user of this browser the whole transcript, and nothing was gained for
        // it: the failed thread is kept either way.
        const second = await PgThreadIndex.ensure("w2");
        const third = await PgThreadIndex.ensure("w3");
        fetchMock.mockImplementation((url: string, init?: RequestInit) => {
          if (url === "/api/sync") {
            return Promise.resolve({
              ok: true,
              json: async () => ({ enabled: true, db: "ok" }),
            });
          }
          const body = JSON.parse(String(init?.body));
          return Promise.resolve(
            body.threadId === second
              ? { ok: false, status: 500, json: async () => ({}) }
              : { ok: true, json: async () => ({ written: 1 }) }
          );
        });
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);
        await PgChatStorage.write(second, [item(2)]);
        await PgChatStorage.write(third, [item(3)]);

        await PgChatSync.forget(await PgChatSync.pushAll());

        expect((await PgChatStorage.threadIds())?.sort()).toEqual([second]);
        expect(await PgChatStorage.read(second)).toHaveLength(1);
      });

      it("keeps them when the threads could not even be listed", async () => {
        // `[].every(Boolean)` is `true`. An enumeration that failed used to answer
        // the same as an account with no conversations, and sign-out deleted every
        // thread on the device having uploaded none of them.
        accepted();
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);
        vi.spyOn(PgFs, "readDir").mockRejectedValue(new Error("quota"));

        expect(await PgChatSync.pushAll()).toBeNull();

        vi.restoreAllMocks();
        expect(await PgChatStorage.read(threadId)).toHaveLength(1);
      });

      it("does not report a thread it could not read as uploaded", async () => {
        // Same shape one level down: an unreadable thread read as an empty one,
        // and `push` reported success for a thread the server never saw -- which
        // is what then let `forget` delete the one file worth recovering
        accepted();
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);
        mockFiles.set(`/.config/chats/${threadId}.json`, "{ not json");

        expect(await PgChatSync.push(threadId)).toBe("failed");
        expect(fetchMock).not.toHaveBeenCalledWith(
          "/api/conversations",
          expect.anything()
        );
      });

      it("still reports a genuinely empty thread as handed over", async () => {
        accepted();
        await signedIn();

        expect(await PgChatSync.push(await PgThreadIndex.ensure("w9"))).toBe(
          "pushed"
        );
      });

      it("drops a thread the server closed under a live project, as handed over", async () => {
        // The server will never take it again; keeping the file for the next
        // user of this browser protects nothing. Counted as `failed`, one such
        // thread kept every other thread on the device too.
        respondingWith(() =>
          Promise.resolve({
            ok: false,
            status: 410,
            json: async () => ({ reason: "deleted", scope: "thread" }),
          })
        );
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        await PgChatSync.forget(await PgChatSync.pushAll());

        expect(await PgChatStorage.threadIds()).toEqual([]);
      });

      it("keeps a thread whose project was deleted, as the project is kept", async () => {
        // `releaseLocalProjects` keeps a project that is waiting for the user's
        // answer about a delete elsewhere, and "keep as new" carries its chat.
        // Dropping the chat here handed that answer an empty conversation.
        respondingWith(() =>
          Promise.resolve({
            ok: false,
            status: 410,
            json: async () => ({ reason: "deleted", scope: "project" }),
          })
        );
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        await PgChatSync.forget(await PgChatSync.pushAll());

        expect(await PgChatStorage.read(threadId)).toEqual([item(1)]);
      });

      it("drops a closed thread and keeps a deleted project's in one hand-over", async () => {
        // Decided per thread: the one under a live project is handed over even
        // though the hand-over as a whole is not complete
        const underDeleted = await PgThreadIndex.ensure("w2");
        fetchMock.mockImplementation((url: string, init?: RequestInit) => {
          if (url === "/api/sync") {
            return Promise.resolve({
              ok: true,
              json: async () => ({ enabled: true, db: "ok" }),
            });
          }
          const body = JSON.parse(String(init?.body));
          const scope = body.threadId === underDeleted ? "project" : "thread";
          return Promise.resolve({
            ok: false,
            status: 410,
            json: async () => ({ reason: "deleted", scope }),
          });
        });
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);
        await PgChatStorage.write(underDeleted, [item(2)]);

        await PgChatSync.forget(await PgChatSync.pushAll());

        expect(await PgChatStorage.threadIds()).toEqual([underDeleted]);
      });

      it("keeps a thread written to after its push", async () => {
        // The sign-out request runs between the push and `forget`, with the panel
        // still open. A reply that finished in that window was deleted unsent.
        accepted();
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        const handed = await PgChatSync.pushAll();
        await PgChatStorage.write(threadId, [item(1), item(2)]);
        await PgChatSync.forget(handed);

        expect(await PgChatStorage.read(threadId)).toEqual([item(1), item(2)]);
      });

      it("keeps a thread that appeared after the push, and drops the rest", async () => {
        // Nothing pushed it, so the directory may no longer be dropped wholesale
        accepted();
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);

        const handed = await PgChatSync.pushAll();
        const later = uuid();
        await PgChatStorage.write(later, [item(2)]);
        await PgChatSync.forget(handed);

        expect(await PgChatStorage.threadIds()).toEqual([later]);
      });

      it("sends nothing while a sign-out tears down", async () => {
        // The server has ended the session by then, so every request answered
        // 401 and was reported as a sync failure on an ordinary sign-out
        accepted();
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);
        let outcome: PushOutcome | undefined;
        PgSession.setOnSignOut(async () => async () => {
          outcome = await PgChatSync.push(threadId);
        });

        await PgSession.signOut();

        expect(outcome).toBe("failed");
        expect(fetchMock).not.toHaveBeenCalledWith(
          "/api/conversations",
          expect.anything()
        );
      });
    });

    describe("pulling a thread that cannot be read locally", () => {
      let mockFiles: Map<string, string>;
      beforeAll(() => {
        mockFiles = (PgFs as unknown as { __files: Map<string, string> })
          .__files;
      });

      let threadId: string;

      beforeEach(async () => {
        await PgChatStorage.clear();
        await PgThreadIndex.clear();
        PgSession.reset();
        PgSyncClient.reset();
        threadId = await PgThreadIndex.ensure("w1");
      });

      it("does not overwrite the local file with the server's half", async () => {
        // `pull` merges local into server and writes the result back. With the
        // local read answering `[]` for a file it could not parse, that write
        // replaces a recoverable file with the server's copy alone -- destroying
        // exactly the messages that had not been uploaded.
        respondingWith(() =>
          Promise.resolve({
            ok: true,
            json: async () => ({ items: [] }),
          })
        );
        await signedIn();
        await PgChatStorage.write(threadId, [item(1)]);
        const corrupt = "{ not json";
        mockFiles.set(`/.config/chats/${threadId}.json`, corrupt);

        await pull(threadId);

        expect(mockFiles.get(`/.config/chats/${threadId}.json`)).toBe(corrupt);
      });
    });

    describe("finding the account's thread for a workspace", () => {
      /**
       * Sign-out clears the thread index, so the next open mints a fresh thread
       * id -- and a pull by that id 404s while the account's conversation sits on
       * the server under the old one.
       */
      let minted: string;
      let accountThread: string;
      beforeAll(() => {
        accountThread = uuid();
      });

      /** The project's threads, newest first; POSTs and pulls are accepted */
      const serverHolds = (ids: string[]) =>
        respondingWith((url) =>
          Promise.resolve({
            ok: true,
            json: async () =>
              url.includes("projectId=")
                ? { threads: ids.map((id) => ({ id })) }
                : { items: [] },
          })
        );

      beforeEach(async () => {
        await PgChatStorage.clear();
        await PgThreadIndex.clear();
        PgSession.reset();
        PgSyncClient.reset();
        minted = await PgThreadIndex.ensure("w1");
      });

      it("asks by project and repoints the workspace at the newest thread", async () => {
        serverHolds([accountThread, uuid()]);
        await signedIn();

        expect(await PgChatSync.adoptAccountThread("w1")).toBe(accountThread);

        expect(fetchMock).toHaveBeenCalledWith(
          "/api/conversations?projectId=w1",
          expect.anything()
        );
        expect(await PgThreadIndex.get("w1")).toBe(accountThread);
      });

      it("carries what was typed locally into the account's thread", async () => {
        serverHolds([accountThread]);
        await signedIn();
        await PgChatStorage.write(minted, [item(3)]);
        await PgChatStorage.write(accountThread, [item(1)]);

        await PgChatSync.adoptAccountThread("w1");

        expect(await PgChatStorage.read(accountThread)).toEqual([
          item(1),
          item(3),
        ]);
        expect(await PgChatStorage.threadIds()).toEqual([accountThread]);
      });

      it("leaves a thread the server already knows alone", async () => {
        serverHolds([uuid(), minted]);
        await signedIn();

        expect(await PgChatSync.adoptAccountThread("w1")).toBeNull();
        expect(await PgThreadIndex.get("w1")).toBe(minted);
      });

      it("keeps the minted thread when the account has none for the project", async () => {
        serverHolds([]);
        await signedIn();

        expect(await PgChatSync.adoptAccountThread("w1")).toBeNull();
        expect(await PgThreadIndex.get("w1")).toBe(minted);
      });

      it("keeps the local thread when the server cannot be reached", async () => {
        respondingWith(() => Promise.reject(new Error("offline")));
        await signedIn();
        await PgChatStorage.write(minted, [item(1)]);

        expect(await PgChatSync.adoptAccountThread("w1")).toBeNull();
        expect(await PgThreadIndex.get("w1")).toBe(minted);
        expect(await PgChatStorage.read(minted)).toHaveLength(1);
      });

      it("does nothing when signed out", async () => {
        await PgChatSync.adoptAccountThreads();

        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("adopts for every workspace in the index", async () => {
        await PgThreadIndex.ensure("w2");
        const other = uuid();
        respondingWith((url) =>
          Promise.resolve({
            ok: true,
            json: async () => ({
              threads: [{ id: url.endsWith("w1") ? accountThread : other }],
            }),
          })
        );
        await signedIn();

        await PgChatSync.adoptAccountThreads();

        expect(await PgThreadIndex.get("w1")).toBe(accountThread);
        expect(await PgThreadIndex.get("w2")).toBe(other);
      });
    });
  });
}
