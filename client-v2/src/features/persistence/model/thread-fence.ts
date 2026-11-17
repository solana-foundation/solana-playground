import {
  removeConfigDir,
  removeConfigFile,
  writeConfigFile,
} from "../../../utils/explorer/config-file";
import { PgFs } from "../../../utils/explorer/fs";
import { decodeThread, mergeThreads } from "./chat-codec";
import { PgChatStorage } from "./chat-storage";
import { report } from "./diagnostics";
import { withSyncLock } from "./sync-lock";
import { PgThreadIndex } from "./thread-index";

/**
 * Which account the chat threads on this device belong to, and where another
 * account's threads wait while someone else is signed in.
 *
 * A project's sync mark is kept per account, so another account's leftover
 * project is never uploaded. Chat threads had no owner: a session that ended
 * without a sign-out left its threads in `/.config/chats`, and the next
 * account's sign-in uploaded every one of them into its own history
 * (HOO-2757). The owner is a file rather than tab memory because who saw the
 * session end does not survive a reload, and two tabs each fencing what they
 * saw would fence the arriving account's fresh threads as the old one's.
 *
 * Fenced threads leave `/.config/chats` altogether. Anything in there is
 * listed by `PgChatStorage.threadIds`, pushed by `pushAll`, and a file no
 * index entry names is adopted by `PgThreadIndex._migrate` as a workspace of
 * its own, so a thread merely unindexed would be uploaded on the next load.
 */

/** The account whose threads `/.config/chats` holds */
const OWNER_PATH = "/.config/chats-owner.json";

/** Another account's threads, one folder per account */
const FENCED_DIR = "/.config/chats-fenced";

const SUFFIX = ".json";

/**
 * Thread id -> where it was open. `workspaceId` is absent for a thread no
 * index entry named.
 */
type FenceRecord = Record<string, { workspaceId?: string }>;

const dirOf = (userId: string) => `${FENCED_DIR}/${encodeURIComponent(userId)}`;
const recordPathOf = (userId: string) => `${dirOf(userId)}/index${SUFFIX}`;
const fencedPathOf = (userId: string, threadId: string) =>
  `${dirOf(userId)}/${encodeURIComponent(threadId)}${SUFFIX}`;
const livePathOf = (threadId: string) =>
  `/.config/chats/${encodeURIComponent(threadId)}${SUFFIX}`;

const isMissing = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  return e?.code === "ENOENT" || !!e?.message?.includes("ENOENT");
};

/** A file's content, `undefined` when there is none; other failures throw */
const readRaw = async (path: string): Promise<string | undefined> => {
  try {
    return await PgFs.readToString(path);
  } catch (e) {
    if (isMissing(e)) return undefined;
    throw e;
  }
};

/** Both copies of a thread as one, newest copy of each item winning */
const mergeRaw = (kept: string, incoming: string) =>
  JSON.stringify(
    mergeThreads(
      decodeThread(JSON.parse(kept)),
      decodeThread(JSON.parse(incoming))
    )
  );

export class PgThreadFence {
  /**
   * Whether `userId` signing in finds another account's threads here, which
   * `settle` will fence: the arriving account must not see them, and a turn
   * running in one has to stop before its file moves.
   */
  static async isOwnedByAnother(userId: string): Promise<boolean> {
    const owner = await PgThreadFence._readOwner();
    return owner !== undefined && owner !== userId;
  }

  /**
   * Whether a fenced account's record names this thread. A push of one is
   * refused: a tab that still had it open can write it back into
   * `/.config/chats` before it learns of the new account.
   */
  static async isFenced(threadId: string): Promise<boolean> {
    const records = await PgThreadFence._readRecords();
    return records.some(({ record }) => threadId in record);
  }

  /**
   * Make `/.config/chats` hold `userId`'s threads only, ahead of its sign-in
   * dump: another owner's threads are fenced, any thread a fence names that
   * reappeared is fenced again, and `userId`'s own fenced threads come back.
   *
   * The owner moves to `userId` only once another owner's threads are out. A
   * fence that could not finish leaves the old owner recorded, so the next
   * sign-in tries again; meanwhile `pushAll` cannot list the folder either,
   * or `push` refuses each thread the record already names.
   */
  static async settle(userId: string): Promise<void> {
    await withSyncLock(async () => {
      const owner = await PgThreadFence._readOwner();
      if (owner !== undefined && owner !== userId) {
        if (!(await PgThreadFence._fenceAll(owner))) return;
      }
      await PgThreadFence._refenceStragglers();
      await PgThreadFence._restore(userId);
      await writeConfigFile(OWNER_PATH, JSON.stringify({ userId }));
    });
  }

  /**
   * Forget the owner. For a sign-out that handed every thread over: nothing
   * is left that belongs to anyone, and threads written next are the next
   * account's to take.
   */
  static async clearOwner(): Promise<void> {
    try {
      await removeConfigFile(OWNER_PATH);
    } catch (e) {
      if (!isMissing(e)) report("clear chat owner", e);
    }
  }

  private static async _readOwner(): Promise<string | undefined> {
    const raw = await readRaw(OWNER_PATH).catch((e) => {
      report("read chat owner", e);
      return undefined;
    });
    if (raw === undefined) return undefined;
    try {
      const userId: unknown = JSON.parse(raw)?.userId;
      return typeof userId === "string" ? userId : undefined;
    } catch (e) {
      report("read chat owner", e);
      return undefined;
    }
  }

  /** Every fenced account's record; an unreadable one is reported and skipped */
  private static async _readRecords(): Promise<
    { userId: string; record: FenceRecord }[]
  > {
    let names: string[];
    try {
      names = await PgFs.readDir(FENCED_DIR);
    } catch (e) {
      if (!isMissing(e)) report("list fenced chats", e);
      return [];
    }
    const records = await Promise.all(
      names.map(async (name) => {
        const userId = decodeURIComponent(name);
        return { userId, record: await PgThreadFence._readRecord(userId) };
      })
    );
    return records;
  }

  private static async _readRecord(userId: string): Promise<FenceRecord> {
    try {
      const raw = await readRaw(recordPathOf(userId));
      if (raw === undefined) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as FenceRecord)
        : {};
    } catch (e) {
      report(`read fenced chats of ${userId}`, e);
      return {};
    }
  }

  /**
   * Move every thread in `/.config/chats` into `userId`'s fence, and empty
   * the index: everything there was that account's.
   *
   * The record is written before any file moves, so a page that dies midway
   * leaves each thread either fenced or named by the record, which `push`
   * refuses.
   *
   * @returns whether every thread is out; `false` keeps the owner as it is
   */
  private static async _fenceAll(userId: string): Promise<boolean> {
    // Read past this tab's cache: another tab may have written the map
    PgThreadIndex.reload();
    const index = await PgThreadIndex.all();
    const stored = await PgChatStorage.threadIds();
    // Nothing can be fenced from a folder that cannot be listed, and nothing
    // can be pushed from it either: `pushAll` gives up on the same answer
    if (stored === null) return false;

    const workspaceOf = new Map(
      Object.entries(index).map(([workspaceId, id]) => [id, workspaceId])
    );
    const threadIds = [...new Set([...workspaceOf.keys(), ...stored])];
    if (!threadIds.length) {
      await PgThreadIndex.clear();
      return true;
    }

    const record = await PgThreadFence._readRecord(userId);
    for (const id of threadIds)
      record[id] ??= { workspaceId: workspaceOf.get(id) };
    try {
      await writeConfigFile(recordPathOf(userId), JSON.stringify(record));
    } catch (e) {
      report(`fence chats of ${userId}`, e);
      return false;
    }

    const moved = await Promise.all(
      threadIds.map((id) => PgThreadFence._moveIn(userId, id))
    );
    if (!moved.every(Boolean)) return false;

    await PgThreadIndex.clear();
    return true;
  }

  /**
   * One thread from `/.config/chats` into `userId`'s fence, merged with a
   * copy already there.
   *
   * @returns whether the live file is gone
   */
  private static async _moveIn(userId: string, threadId: string) {
    try {
      const live = await readRaw(livePathOf(threadId));
      if (live === undefined) return true;
      const fencedPath = fencedPathOf(userId, threadId);
      const fenced = await readRaw(fencedPath);
      await writeConfigFile(
        fencedPath,
        fenced === undefined ? live : mergeRaw(fenced, live)
      );
    } catch (e) {
      report(`fence thread ${threadId}`, e);
      return false;
    }
    return PgChatStorage.remove(threadId);
  }

  /**
   * Fence again any thread a record names that is back in `/.config/chats`:
   * a tab that had it open wrote to it before it noticed the new account.
   */
  private static async _refenceStragglers() {
    const stored = await PgChatStorage.threadIds();
    if (!stored?.length) return;
    for (const { userId, record } of await PgThreadFence._readRecords()) {
      const back = stored.filter((id) => id in record);
      await Promise.all(back.map((id) => PgThreadFence._moveIn(userId, id)));
    }
  }

  /**
   * Put `userId`'s fenced threads back.
   *
   * A thread goes back to its workspace when the workspace has no thread
   * now, entry first: an entry with no file reads as an empty thread, while a
   * file with no entry would be adopted as a workspace of its own. When the
   * workspace took another thread meanwhile, the fenced one is merged into
   * it; that thread is uploaded to `userId` in the same dump. A thread no
   * entry named goes back unnamed, as it was.
   *
   * The fence folder goes only when every thread is back.
   */
  private static async _restore(userId: string) {
    const record = await PgThreadFence._readRecord(userId);
    const threadIds = Object.keys(record);
    if (!threadIds.length) return;

    const index = await PgThreadIndex.all();
    let restored = true;
    for (const threadId of threadIds) {
      try {
        const fenced = await readRaw(fencedPathOf(userId, threadId));
        const { workspaceId } = record[threadId];
        const occupant = workspaceId ? index[workspaceId] : undefined;
        if (fenced === undefined) continue;

        if (occupant && occupant !== threadId) {
          const live = await readRaw(livePathOf(occupant));
          await writeConfigFile(
            livePathOf(occupant),
            live === undefined ? fenced : mergeRaw(live, fenced)
          );
          continue;
        }
        if (workspaceId) await PgThreadIndex.set(workspaceId, threadId);
        const live = await readRaw(livePathOf(threadId));
        await writeConfigFile(
          livePathOf(threadId),
          live === undefined ? fenced : mergeRaw(live, fenced)
        );
      } catch (e) {
        report(`restore thread ${threadId}`, e);
        restored = false;
      }
    }
    if (!restored) return;

    try {
      await removeConfigDir(dirOf(userId));
    } catch (e) {
      if (!isMissing(e)) report(`drop fenced chats of ${userId}`, e);
    }
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach } = import.meta.vitest;
  type ChatItem = import("../../../views/sidebar/assistant/store").ChatItem;

  describe("features/persistence/model/thread-fence", () => {
    const item = (n: number): ChatItem => ({
      kind: "user",
      id: `6f1c2b0e-0000-4000-8000-00000000000${n}`,
      createdAt: new Date(n * 1000).toISOString(),
      text: `m${n}`,
    });
    const idsOf = (items: readonly ChatItem[] | null) =>
      (items ?? []).map(({ id }) => id);

    /** A thread on `workspaceId` holding `items`, as the panel leaves one */
    const chat = async (workspaceId: string, items: ChatItem[]) => {
      const threadId = await PgThreadIndex.ensure(workspaceId);
      await PgChatStorage.write(threadId, items);
      return threadId;
    };

    beforeEach(async () => {
      await PgChatStorage.clear();
      await PgThreadIndex.clear();
      await PgThreadFence.clearOwner();
      try {
        await removeConfigDir(FENCED_DIR);
      } catch (e) {
        // Nothing fenced yet is the usual state
        if (!isMissing(e)) throw e;
      }
    });

    it("keeps the threads of a device nobody owned for the first account", async () => {
      const threadId = await chat("w1", [item(1)]);

      await PgThreadFence.settle("ada");

      expect(await PgChatStorage.threadIds()).toEqual([threadId]);
      expect(await PgThreadFence.isOwnedByAnother("ada")).toBe(false);
    });

    it("fences another owner's threads out of the folder and the index", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);

      expect(await PgThreadFence.isOwnedByAnother("bob")).toBe(true);
      await PgThreadFence.settle("bob");

      expect(await PgChatStorage.threadIds()).toEqual([]);
      expect(await PgThreadIndex.get("w1")).toBeNull();
      expect(await PgThreadFence.isFenced(threadId)).toBe(true);
      expect(await PgThreadFence.isOwnedByAnother("bob")).toBe(false);
    });

    it("puts the owner's threads back on its workspace when it returns", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);
      await PgThreadFence.settle("bob");

      await PgThreadFence.settle("ada");

      expect(await PgThreadIndex.get("w1")).toBe(threadId);
      expect(idsOf(await PgChatStorage.read(threadId))).toEqual([item(1).id]);
      expect(await PgThreadFence.isFenced(threadId)).toBe(false);
    });

    it("merges a returning thread into the one that took its workspace", async () => {
      await PgThreadFence.settle("ada");
      await chat("w1", [item(1)]);
      await PgThreadFence.settle("bob");
      // Bob signs out with everything handed over; Ada chats there signed out
      await PgThreadFence.clearOwner();
      const taken = await chat("w1", [item(2)]);

      await PgThreadFence.settle("ada");

      expect(await PgThreadIndex.get("w1")).toBe(taken);
      expect(idsOf(await PgChatStorage.read(taken)).sort()).toEqual(
        [item(1).id, item(2).id].sort()
      );
    });

    it("fences again a thread a lagging tab wrote back", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);
      await PgThreadFence.settle("bob");
      // The other tab's panel still had it open and wrote a reply into it
      await PgChatStorage.write(threadId, [item(1), item(2)]);

      await PgThreadFence.settle("bob");
      expect(await PgChatStorage.threadIds()).toEqual([]);

      await PgThreadFence.settle("ada");
      expect(idsOf(await PgChatStorage.read(threadId)).sort()).toEqual(
        [item(1).id, item(2).id].sort()
      );
    });
  });
}
