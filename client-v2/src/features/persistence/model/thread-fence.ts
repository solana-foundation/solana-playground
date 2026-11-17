import { isMissing } from "@/shared/lib/is-missing";

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

/** `PgThreadIndex`'s map, which a fence must leave gone */
const INDEX_PATH = "/.config/chats/index.json";

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

/** A file's content, `undefined` when there is none; other failures throw */
const readRaw = async (path: string): Promise<string | undefined> => {
  try {
    return await PgFs.readToString(path);
  } catch (e) {
    if (isMissing(e)) return undefined;
    throw e;
  }
};

/** A copy's items, or `undefined` for bytes that are not JSON */
const parseRaw = (raw: string) => {
  try {
    return decodeThread(JSON.parse(raw));
  } catch {
    // `mergeRawFor` reports the copy it drops for this
    return undefined;
  }
};

// TODO(HOO-2757 follow-up): the copy dropped here, and items `decodeThread`
// cannot read, are gone for good; keeping them aside needs a quarantine
// folder of its own
/**
 * Both copies of a thread as one, newest copy of each item winning.
 *
 * A copy that is not JSON is dropped, and said so: `PgChatStorage.read`
 * cannot read it either, so it was already lost to the panel and to every
 * push. Throwing instead would fail the fence on every sign-in for good.
 */
const mergeRawFor = (threadId: string) => (kept: string, incoming: string) => {
  const keptItems = parseRaw(kept);
  const incomingItems = parseRaw(incoming);
  if (keptItems === undefined || incomingItems === undefined) {
    // No content in the report: it reaches Sentry, and a thread is the
    // person's prompts and code
    report(
      `merge thread ${threadId}: dropped a copy that is not JSON`,
      new Error("not JSON")
    );
    if (keptItems !== undefined) return kept;
    return incoming;
  }
  return JSON.stringify(mergeThreads(keptItems, incomingItems));
};

/** A record's bytes as one, `undefined` when they are not */
const parseRecord = (raw: string): FenceRecord | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FenceRecord;
    }
  } catch {
    // The caller reports it and rebuilds the record
  }
  return undefined;
};

/**
 * Who owns `/.config/chats`. `unreadable` is kept apart from `none`, because
 * reading a failure as "nobody" would hand another account's threads to
 * whoever signs in: every caller fails closed on it.
 */
type Owner =
  | { kind: "none" }
  | { kind: "user"; userId: string }
  | { kind: "unreadable" }
  | { kind: "corrupt" };

/**
 * The fence for threads whose owner file was readable but meaningless. Not
 * an id an account can have, so no sign-in ever restores them; they stay on
 * the device, where a person can still recover them by hand.
 */
const UNKNOWN_OWNER = "~unknown";

/** Whose threads the folder holds, for an owner that could be read */
const previousOwnerOf = (owner: Owner): string | undefined => {
  if (owner.kind === "user") return owner.userId;
  if (owner.kind === "corrupt") return UNKNOWN_OWNER;
  return undefined;
};

export class PgThreadFence {
  /**
   * Whether `userId` signing in finds threads that may be another account's,
   * which `settle` will fence: the arriving account must not see them, and a
   * turn running in one has to stop before its file moves. An owner that
   * cannot be read counts as another.
   */
  static async isOwnedByAnother(userId: string): Promise<boolean> {
    const owner = await PgThreadFence._readOwner();
    if (owner.kind === "unreadable" || owner.kind === "corrupt") return true;
    return owner.kind === "user" && owner.userId !== userId;
  }

  /**
   * Record `userId` as the owner of a folder nobody owns, under the lock;
   * an owner already recorded is left as it is.
   *
   * The retry for a sign-in whose owner write failed: `push` claims the
   * folder this way before every upload, and refuses the thread when the
   * claim fails, and a sign-out with none recorded would leave this
   * account's threads unowned for whoever signs in next.
   * If the store keeps refusing this one file while thread writes still
   * land, nothing on this device can say whose the threads are, and the
   * next account's sign-in takes them; accepted, since every push and the
   * sign-out retry it first.
   *
   * @returns whether the folder is `userId`'s now
   */
  static async claimUnowned(userId: string): Promise<boolean> {
    return withSyncLock(async () => {
      const owner = await PgThreadFence._readOwner();
      if (owner.kind === "none") return PgThreadFence._writeOwner(userId);
      return owner.kind === "user" && owner.userId === userId;
    });
  }

  /**
   * Whether a fenced account's record names this thread, or the records
   * cannot be read. A push of one is refused: a tab that still had it open
   * can write it back into `/.config/chats` before it learns of the new
   * account.
   */
  static async isFenced(threadId: string): Promise<boolean> {
    const records = await PgThreadFence._readRecords();
    if (!records) return true;
    return records.some(({ record }) => threadId in record);
  }

  /**
   * Make `/.config/chats` hold `userId`'s threads only, ahead of its sign-in
   * dump: another owner's threads are fenced, any thread a fence names that
   * reappeared is fenced again, and `userId`'s own fenced threads come back.
   *
   * The owner moves to `userId` only once another owner's threads are out. A
   * fence that could not finish leaves the old owner recorded, so the next
   * sign-in tries again, and `push` refuses every thread while the owner is
   * not the signed-in account.
   *
   * Records the outcome for `isSettledFor`, and never rejects: a throw
   * reads as `false`.
   *
   * @returns whether `/.config/chats` is `userId`'s now; `false` means the
   * caller must not adopt or upload the threads there
   */
  static settle(userId: string): Promise<boolean> {
    // One at a time in this tab: the sync lock does not order callers within
    // a tab, and a second `settle` reading the owner before the first wrote
    // it would fence the arriving account's restored threads as the old
    // account's
    const settled = PgThreadFence._settling.then(() =>
      PgThreadFence._settleRecorded(userId)
    );
    PgThreadFence._settling = settled;
    return settled;
  }

  /**
   * Whether this tab's last `settle` made `/.config/chats` `userId`'s.
   *
   * The chat effect opens no thread for a signed-in account until this
   * holds. Kept as the account a settle succeeded for, not as a failure
   * flag, so the gate is closed from the moment another account signs in
   * until its settle has finished, and stays closed after a settle that
   * failed or threw: a thread opened or minted then would be written into a
   * folder still recorded as another account's, and the next fence would
   * file it as that account's.
   */
  // TODO(HOO-2757 follow-up): per-tab memory, never invalidated by another
  // tab's sign-out or sign-in; see `_fenceAll`
  static isSettledFor(userId: string): boolean {
    return PgThreadFence._settled === userId;
  }

  /** The account this tab's last `settle` succeeded for */
  private static _settled: string | undefined;

  /** The tail of this tab's `settle` calls, which never rejects */
  private static _settling: Promise<unknown> = Promise.resolve();

  /** `_settle`, with its outcome recorded for `isSettledFor` */
  private static async _settleRecorded(userId: string): Promise<boolean> {
    let settled = false;
    try {
      settled = await PgThreadFence._settle(userId);
    } catch (e) {
      // The sync lock or storage threw: unsettled, exactly as a refusal
      report(`settle chats for ${userId}`, e);
    }
    PgThreadFence._settled = settled ? userId : undefined;
    return settled;
  }

  private static async _settle(userId: string): Promise<boolean> {
    return withSyncLock(async () => {
      const owner = await PgThreadFence._readOwner();
      // Most likely a passing storage fault: the next sign-in reads again
      if (owner.kind === "unreadable") return false;
      // Bytes that will never parse would stop chat sync for good, so the
      // threads go to a fence of their own, kept on this device for nobody
      const previous = previousOwnerOf(owner);
      const fencing = previous !== undefined && previous !== userId;
      if (fencing && !(await PgThreadFence._fenceAll(previous))) return false;
      // The new owner goes down while the folder holds nobody's threads,
      // before any of this account's: an owner left naming the previous
      // account would have the next sign-in fence this account's threads as
      // that account's, and hand them to it. Already this account's, there
      // is nothing to write, and nothing a failed write could undo.
      if (previous !== userId) {
        const written = fencing
          ? await PgThreadFence._writeOwnerOverEmpty(userId)
          : await PgThreadFence._writeOwner(userId);
        if (!written) return false;
      }
      if (!(await PgThreadFence._refenceStragglers())) return false;
      await PgThreadFence._restore(userId);
      await PgThreadFence._dropFencedFromCache();
      return true;
    });
  }

  /**
   * Re-read the index when this tab's copy still names a fenced thread:
   * another tab fenced it, and the panel must not be handed it again. Only
   * then, because a re-read can drop an entry this tab minted and has not
   * written yet, and the workspace would mint a second thread.
   */
  private static async _dropFencedFromCache() {
    const records = (await PgThreadFence._readRecords()) ?? [];
    const fenced = new Set(
      records.flatMap(({ record }) => Object.keys(record))
    );
    const cached = Object.values(await PgThreadIndex.all());
    if (cached.some((id) => fenced.has(id))) PgThreadIndex.reload();
  }

  /**
   * Record `userId` as the owner of threads nobody owned. A failure leaves
   * them unowned, and the caller refuses the dump: uploaded without an owner
   * on record, they would be uploaded again into whoever signs in after this
   * account's session ends.
   */
  private static async _writeOwner(userId: string): Promise<boolean> {
    try {
      await writeConfigFile(OWNER_PATH, JSON.stringify({ userId }));
      return true;
    } catch (e) {
      report("write chat owner", e);
      return false;
    }
  }

  /**
   * `_writeOwner` right after a fence emptied the folder. When the write
   * fails, the old owner file is removed instead: the folder holds nobody's
   * threads, and a name left over them would have the next sign-in fence
   * this account's threads as the old account's.
   */
  // TODO(HOO-2757 follow-up): when the removal fails too, the old owner stays
  // named over this account's next threads; a lagging tab writing then is a
  // third fault, so a fail-closed marker waits for a report of it
  private static async _writeOwnerOverEmpty(userId: string): Promise<boolean> {
    if (await PgThreadFence._writeOwner(userId)) return true;
    await PgThreadFence.clearOwner();
    return false;
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

  private static async _readOwner(): Promise<Owner> {
    let raw: string | undefined;
    try {
      raw = await readRaw(OWNER_PATH);
    } catch (e) {
      report("read chat owner", e);
      return { kind: "unreadable" };
    }
    if (raw === undefined) return { kind: "none" };
    try {
      const userId: unknown = JSON.parse(raw)?.userId;
      if (typeof userId === "string") return { kind: "user", userId };
    } catch (e) {
      report("read chat owner: not JSON", e);
      return { kind: "corrupt" };
    }
    report("read chat owner: no user id", new Error("no user id"));
    return { kind: "corrupt" };
  }

  /**
   * Every fenced account's record, or `undefined` when any of them, or the
   * folder, cannot be read: the callers refuse rather than guess.
   */
  private static async _readRecords(): Promise<
    { userId: string; record: FenceRecord }[] | undefined
  > {
    let names: string[];
    try {
      names = await PgFs.readDir(FENCED_DIR);
    } catch (e) {
      if (isMissing(e)) return [];
      report("list fenced chats", e);
      return undefined;
    }
    const records = await Promise.all(
      names.map(async (name) => {
        let userId: string;
        try {
          userId = decodeURIComponent(name);
        } catch (e) {
          report(`list fenced chats: ${name}`, e);
          return undefined;
        }
        const record = await PgThreadFence._readRecord(userId);
        return record && { userId, record };
      })
    );
    return records.every((r) => r !== undefined)
      ? (records as { userId: string; record: FenceRecord }[])
      : undefined;
  }

  /**
   * `userId`'s record, `{}` when it has none, `undefined` when it cannot be
   * read. A record whose bytes are not one is rebuilt from the threads in
   * its folder.
   */
  private static async _readRecord(
    userId: string
  ): Promise<FenceRecord | undefined> {
    let raw: string | undefined;
    try {
      raw = await readRaw(recordPathOf(userId));
    } catch (e) {
      report(`read fenced chats of ${userId}`, e);
      return undefined;
    }
    if (raw === undefined) return {};
    const record = parseRecord(raw);
    if (record) return record;
    report(
      `read fenced chats of ${userId}: not a record`,
      new Error("corrupt")
    );
    return PgThreadFence._rebuildRecord(userId);
  }

  /**
   * A record from the thread files in `userId`'s folder, written over one
   * that will never parse. Refusing on it instead, as on a read that
   * failed, refused every thread of every account and failed every `settle`
   * after it for good. The workspaces it named are lost: those threads come
   * back unnamed, each adopted as a workspace of its own.
   */
  private static async _rebuildRecord(
    userId: string
  ): Promise<FenceRecord | undefined> {
    let names: string[];
    try {
      names = await PgFs.readDir(dirOf(userId));
    } catch (e) {
      report(`rebuild fenced chats of ${userId}`, e);
      return undefined;
    }
    const record: FenceRecord = {};
    for (const name of names) {
      if (!name.endsWith(SUFFIX) || name === `index${SUFFIX}`) continue;
      try {
        record[decodeURIComponent(name.slice(0, -SUFFIX.length))] = {};
      } catch (e) {
        // Not a name the fence writes: no thread id to restore it under, and
        // a throw here would fail every settle and push after it
        report(`rebuild fenced chats of ${userId}: skipped ${name}`, e);
      }
    }
    try {
      await writeConfigFile(recordPathOf(userId), JSON.stringify(record));
    } catch (e) {
      // Answered from memory meanwhile; the next read rebuilds it again
      report(`rebuild fenced chats of ${userId}`, e);
    }
    return record;
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
    // Read past this tab's cache: another tab may have written the map. A
    // map that cannot be read is not an empty one: fenced on it, every thread
    // would lose its workspace and the real map would be cleared
    const index = await PgThreadIndex.reloadOrFail();
    if (!index) return false;
    const stored = await PgChatStorage.threadIds();
    // Nothing can be fenced from a folder that cannot be listed
    if (stored === null) return false;

    // TODO(HOO-2757 follow-up): a thread a lagging tab of the old account
    // mints after this listing is in no record and stays in the folder as
    // the new owner's. That tab's gate (`isSettledFor`) is its own memory,
    // and nothing re-reads the session on a switch, so a tab that has not
    // yet seen the other account's sign-in can still mint; it needs a second
    // tab and a switch there inside the sign-in.
    const workspaceOf = new Map(
      Object.entries(index).map(([workspaceId, id]) => [id, workspaceId])
    );
    const threadIds = [...new Set([...workspaceOf.keys(), ...stored])];
    if (!threadIds.length) return PgThreadFence._clearIndex();

    // Rewritten over an unreadable record, it would lose the threads it named
    const record = await PgThreadFence._readRecord(userId);
    if (!record) return false;
    for (const id of threadIds) {
      record[id] ??= { workspaceId: workspaceOf.get(id) };
    }
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

    return PgThreadFence._clearIndex();
  }

  /**
   * Empty the index, and say whether it is empty. `PgThreadIndex.clear`
   * reports its own failure and returns nothing, and an index left naming
   * the old account's threads would reopen one in the new account's panel,
   * whose messages would then be fenced as the old account's.
   */
  private static async _clearIndex(): Promise<boolean> {
    await PgThreadIndex.clear();
    // The file itself, not `PgThreadIndex.all`, which reads a failure as an
    // empty map and so would pass exactly when storage fails
    try {
      return !(await PgFs.exists(INDEX_PATH));
    } catch (e) {
      report("check chat index", e);
      return false;
    }
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
        fenced === undefined ? live : mergeRawFor(threadId)(fenced, live)
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
   *
   * @returns whether none is left in `/.config/chats`
   */
  private static async _refenceStragglers(): Promise<boolean> {
    const stored = await PgChatStorage.threadIds();
    if (stored === null) return false;
    if (!stored.length) return true;
    const records = await PgThreadFence._readRecords();
    if (!records) return false;
    let moved = true;
    for (const { userId, record } of records) {
      const back = stored.filter((id) => id in record);
      const results = await Promise.all(
        back.map((id) => PgThreadFence._moveIn(userId, id))
      );
      moved &&= results.every(Boolean);
    }
    return moved;
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
   * Each thread leaves the record once it is back, so a restore that fails
   * partway keeps only the rest fenced: a record still naming a restored
   * thread would make `push` refuse it. The folder goes with the last one.
   */
  private static async _restore(userId: string) {
    const record = await PgThreadFence._readRecord(userId);
    if (!record) return;
    const threadIds = Object.keys(record);
    if (!threadIds.length) return;

    // Past this tab's cache: another tab may have given a workspace a thread.
    // Unreadable, the threads stay fenced for the next sign-in: put back on
    // a guessed empty map, each would go back unnamed and `set` would write
    // that guess over the real map
    const index = await PgThreadIndex.reloadOrFail();
    if (!index) return;
    const left: FenceRecord = {};
    for (const threadId of threadIds) {
      const workspaceId = record[threadId]?.workspaceId;
      const occupant = workspaceId ? index[workspaceId] : undefined;
      try {
        await PgThreadFence._putBack(userId, {
          threadId,
          workspaceId,
          occupant,
        });
      } catch (e) {
        report(`restore thread ${threadId}`, e);
        left[threadId] = record[threadId];
      }
    }

    try {
      if (Object.keys(left).length) {
        await writeConfigFile(recordPathOf(userId), JSON.stringify(left));
      } else {
        await removeConfigDir(dirOf(userId));
      }
    } catch (e) {
      report(`settle fenced chats of ${userId}`, e);
    }
  }

  /** One fenced thread back into `/.config/chats`; throws when it is not */
  private static async _putBack(
    userId: string,
    {
      threadId,
      workspaceId,
      occupant,
    }: { threadId: string; workspaceId?: string; occupant?: string }
  ) {
    const fenced = await readRaw(fencedPathOf(userId, threadId));
    if (fenced === undefined) return;

    const target = occupant && occupant !== threadId ? occupant : threadId;
    if (target === threadId && workspaceId) {
      await PgThreadIndex.set(workspaceId, threadId);
      // `set` reports a failed write and returns nothing, and a file put
      // back with no entry would be adopted as a workspace of its own
      const written = await PgThreadIndex.reloadOrFail();
      if (written?.[workspaceId] !== threadId) {
        throw new Error(`index entry for ${workspaceId} was not written`);
      }
    }
    const live = await readRaw(livePathOf(target));
    await writeConfigFile(
      livePathOf(target),
      live === undefined ? fenced : mergeRawFor(target)(live, fenced)
    );
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach, afterEach, vi } = import.meta
    .vitest;
  type ChatItem = import("../../../views/sidebar/assistant/store").ChatItem;

  describe("features/persistence/model/thread-fence", () => {
    const item = (n: number): ChatItem => ({
      kind: "user",
      id: `6f1c2b0e-0000-4000-8000-00000000000${n}`,
      createdAt: new Date(n * 1000).toISOString(),
      text: `m${n}`,
    });
    const uuidOf = (n: number) => `6f1c2b0e-0000-4000-8000-00000000000${n}`;
    const idsOf = (items: readonly ChatItem[] | null) =>
      (items ?? []).map(({ id }) => id);

    /** A thread on `workspaceId` holding `items`, as the panel leaves one */
    const chat = async (workspaceId: string, items: ChatItem[]) => {
      const threadId = await PgThreadIndex.ensure(workspaceId);
      await PgChatStorage.write(threadId, items);
      return threadId;
    };

    afterEach(() => vi.restoreAllMocks());

    beforeEach(async () => {
      // A fresh tab: no account settled yet
      Reflect.set(PgThreadFence, "_settled", undefined);
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

    it("leaves the owner and every thread where they are when the record cannot be written", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);
      const write = PgFs.writeFile.bind(PgFs);
      vi.spyOn(PgFs, "writeFile").mockImplementation(
        // eslint-disable-next-line max-params -- `PgFs.writeFile`'s own signature
        async (path, data, opts) => {
          if (path.startsWith(FENCED_DIR)) throw new Error("QuotaExceeded");
          return write(path, data, opts);
        }
      );

      expect(await PgThreadFence.settle("bob")).toBe(false);

      expect(await PgThreadFence.isOwnedByAnother("bob")).toBe(true);
      expect(await PgChatStorage.threadIds()).toEqual([threadId]);
    });

    it("fences the threads under an owner that is not JSON for nobody", async () => {
      const threadId = await chat("w1", [item(1)]);
      await writeConfigFile(OWNER_PATH, "{not json");

      expect(await PgThreadFence.isOwnedByAnother("ada")).toBe(true);
      expect(await PgThreadFence.settle("ada")).toBe(true);

      expect(await PgChatStorage.threadIds()).toEqual([]);
      expect(await PgThreadFence.isFenced(threadId)).toBe(true);
      expect(await PgThreadFence.isOwnedByAnother("ada")).toBe(false);
    });

    it("names no owner when the new one cannot be written after a fence", async () => {
      await PgThreadFence.settle("ada");
      await chat("w1", [item(1)]);
      const write = PgFs.writeFile.bind(PgFs);
      vi.spyOn(PgFs, "writeFile").mockImplementation(
        // eslint-disable-next-line max-params -- `PgFs.writeFile`'s own signature
        async (path, data, opts) => {
          if (path === OWNER_PATH) throw new Error("QuotaExceeded");
          return write(path, data, opts);
        }
      );

      expect(await PgThreadFence.settle("bob")).toBe(false);

      // Not Ada: a thread Bob writes next must never be fenced as hers
      expect(await PgThreadFence.isOwnedByAnother("bob")).toBe(false);
      expect(await PgThreadFence.isOwnedByAnother("carol")).toBe(false);
      expect(await PgChatStorage.threadIds()).toEqual([]);
    });

    it("rebuilds a fence record that is not JSON from the threads in its folder", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);
      await PgThreadFence.settle("bob");
      await writeConfigFile(recordPathOf("ada"), "{broken");

      expect(await PgThreadFence.isFenced(uuidOf(9))).toBe(false);
      expect(await PgThreadFence.isFenced(threadId)).toBe(true);
      expect(await PgThreadFence.settle("bob")).toBe(true);

      expect(await PgThreadFence.settle("ada")).toBe(true);
      expect(idsOf(await PgChatStorage.read(threadId))).toEqual([item(1).id]);
    });

    it("skips a file name that does not decode when it rebuilds a record", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);
      await PgThreadFence.settle("bob");
      await writeConfigFile(`${dirOf("ada")}/%E0%A4%A.json`, "{}");
      await writeConfigFile(recordPathOf("ada"), "{broken");

      expect(await PgThreadFence.isFenced(threadId)).toBe(true);
      expect(await PgThreadFence.settle("bob")).toBe(true);
    });

    it("refuses every thread while the fenced folder cannot be listed", async () => {
      await PgThreadFence.settle("ada");
      await chat("w1", [item(1)]);
      await PgThreadFence.settle("bob");
      vi.spyOn(PgFs, "readDir").mockRejectedValue(new Error("EIO"));

      expect(await PgThreadFence.isFenced(uuidOf(9))).toBe(true);
    });

    describe("an index that cannot be read", () => {
      const failIndexReads = () => {
        const read = PgFs.readToString.bind(PgFs);
        vi.spyOn(PgFs, "readToString").mockImplementation(async (path) => {
          if (path === INDEX_PATH) throw new Error("EIO");
          return read(path);
        });
      };

      it("does not fence on it", async () => {
        await PgThreadFence.settle("ada");
        const threadId = await chat("w1", [item(1)]);
        failIndexReads();

        expect(await PgThreadFence.settle("bob")).toBe(false);
        vi.restoreAllMocks();

        expect(await PgThreadFence.isOwnedByAnother("bob")).toBe(true);
        PgThreadIndex.reload();
        expect(await PgThreadIndex.get("w1")).toBe(threadId);
      });

      it("keeps the threads fenced rather than put them back unnamed", async () => {
        await PgThreadFence.settle("ada");
        const threadId = await chat("w1", [item(1)]);
        await PgThreadFence.settle("bob");
        await PgThreadFence.clearOwner();
        failIndexReads();

        await PgThreadFence.settle("ada");
        vi.restoreAllMocks();

        expect(await PgThreadFence.isFenced(threadId)).toBe(true);
        expect(await PgChatStorage.threadIds()).toEqual([]);
        await PgThreadFence.settle("ada");
        expect(await PgThreadIndex.get("w1")).toBe(threadId);
      });
    });

    describe("the tab's settled account", () => {
      it("is none before a settle and the account after one", async () => {
        expect(PgThreadFence.isSettledFor("ada")).toBe(false);

        await PgThreadFence.settle("ada");

        expect(PgThreadFence.isSettledFor("ada")).toBe(true);
        expect(PgThreadFence.isSettledFor("bob")).toBe(false);
      });

      it("is not the account whose settle failed", async () => {
        await PgThreadFence.settle("ada");
        await chat("w1", [item(1)]);
        vi.spyOn(PgFs, "writeFile").mockRejectedValue(new Error("Quota"));

        expect(await PgThreadFence.settle("bob")).toBe(false);

        expect(PgThreadFence.isSettledFor("bob")).toBe(false);
        expect(PgThreadFence.isSettledFor("ada")).toBe(false);
      });

      it("is not the account whose settle threw", async () => {
        await PgThreadFence.settle("ada");
        vi.spyOn(PgChatStorage, "threadIds").mockRejectedValue(
          new Error("lock")
        );

        expect(await PgThreadFence.settle("bob")).toBe(false);
        expect(PgThreadFence.isSettledFor("bob")).toBe(false);
      });
    });

    it("runs one settle at a time in a tab", async () => {
      await PgThreadFence.settle("ada");
      await chat("w1", [item(1)]);
      let running = 0;
      let overlapped = false;
      const threadIds = PgChatStorage.threadIds.bind(PgChatStorage);
      vi.spyOn(PgChatStorage, "threadIds").mockImplementation(async () => {
        running++;
        overlapped ||= running > 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return threadIds();
      });

      await Promise.all([
        PgThreadFence.settle("bob"),
        PgThreadFence.settle("bob"),
      ]);

      expect(overlapped).toBe(false);
      expect(PgThreadFence.isSettledFor("bob")).toBe(true);
    });

    it("does not settle while a straggler stays in the folder", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);
      await PgThreadFence.settle("bob");
      await PgChatStorage.write(threadId, [item(2)]);
      const write = PgFs.writeFile.bind(PgFs);
      vi.spyOn(PgFs, "writeFile").mockImplementation(
        // eslint-disable-next-line max-params -- `PgFs.writeFile`'s own signature
        async (path, data, opts) => {
          if (path.startsWith(FENCED_DIR)) throw new Error("QuotaExceeded");
          return write(path, data, opts);
        }
      );

      expect(await PgThreadFence.settle("bob")).toBe(false);
    });

    it("keeps the thread that decodes when a fenced copy is not JSON", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);
      await PgThreadFence.settle("bob");
      await writeConfigFile(fencedPathOf("ada", threadId), "{broken");
      await PgChatStorage.write(threadId, [item(2)]);

      expect(await PgThreadFence.settle("bob")).toBe(true);
      expect(await PgChatStorage.threadIds()).toEqual([]);
      await PgThreadFence.settle("ada");
      expect(idsOf(await PgChatStorage.read(threadId))).toEqual([item(2).id]);
    });

    it("does not settle when the index cannot be emptied", async () => {
      await PgThreadFence.settle("ada");
      await chat("w1", [item(1)]);
      const remove = PgFs.removeFile.bind(PgFs);
      vi.spyOn(PgFs, "removeFile").mockImplementation(async (path) => {
        if (
          path.endsWith("/index.json") &&
          path.startsWith("/.config/chats/")
        ) {
          throw new Error("EIO");
        }
        return remove(path);
      });

      expect(await PgThreadFence.settle("bob")).toBe(false);
      expect(await PgThreadFence.isOwnedByAnother("bob")).toBe(true);
    });

    it("keeps the owner when it is already the arriving account", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);
      vi.spyOn(PgFs, "writeFile").mockRejectedValue(new Error("QuotaExceeded"));

      expect(await PgThreadFence.settle("ada")).toBe(true);
      vi.restoreAllMocks();

      expect(await PgThreadFence.isOwnedByAnother("bob")).toBe(true);
      await PgThreadFence.settle("bob");
      expect(await PgThreadFence.isFenced(threadId)).toBe(true);
    });

    it("does not settle threads nobody owned when the owner cannot be written", async () => {
      await chat("w1", [item(1)]);
      vi.spyOn(PgFs, "writeFile").mockRejectedValue(new Error("QuotaExceeded"));

      expect(await PgThreadFence.settle("ada")).toBe(false);
    });

    it("drops a thread another tab fenced from this tab's index", async () => {
      await PgThreadFence.settle("ada");
      const threadId = await chat("w1", [item(1)]);
      const stale = { w1: threadId };
      await PgThreadFence.settle("bob");
      // This tab still holds Ada's entry from before the other tab's fence
      await writeConfigFile("/.config/chats/index.json", JSON.stringify({}));
      PgThreadIndex.reload();
      await PgThreadIndex.set("w1", stale.w1);
      await writeConfigFile("/.config/chats/index.json", JSON.stringify({}));

      await PgThreadFence.settle("bob");

      expect(await PgThreadIndex.get("w1")).toBeNull();
    });
  });
}
