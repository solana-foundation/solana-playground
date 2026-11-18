import { isMissing } from "@/shared/lib/is-missing";

import { writeConfigFile } from "../../../utils/explorer/config-file";
import { PgFs } from "../../../utils/explorer/fs";
import { report } from "./diagnostics";

/**
 * Where another account's chat threads wait, and how their records are read.
 *
 * A module of its own, apart from `PgThreadFence`, because `PgThreadIndex`
 * needs the fenced ids for its migration while the fence needs the index:
 * the production build refuses the import cycle the two would make.
 */

/** Another account's threads, one folder per account */
export const FENCED_DIR = "/.config/chats-fenced";

export const SUFFIX = ".json";

/**
 * Thread id -> where it was open. `workspaceId` is absent for a thread no
 * index entry named.
 */
export type FenceRecord = Record<string, { workspaceId?: string }>;

export const dirOf = (userId: string) =>
  `${FENCED_DIR}/${encodeURIComponent(userId)}`;
export const recordPathOf = (userId: string) =>
  `${dirOf(userId)}/index${SUFFIX}`;

/** A file's content, `undefined` when there is none; other failures throw */
export const readRaw = async (path: string): Promise<string | undefined> => {
  try {
    return await PgFs.readToString(path);
  } catch (e) {
    if (isMissing(e)) return undefined;
    throw e;
  }
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
 * Every fenced account's record, or `undefined` when any of them, or the
 * folder, cannot be read: the callers refuse rather than guess.
 */
export const readRecords = async (): Promise<
  { userId: string; record: FenceRecord }[] | undefined
> => {
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
        // Not a folder the fence writes, so no account's record: skipped,
        // since refusing on it would refuse every push and settle for good
        report(`list fenced chats: skipped ${name}`, e);
        return "skipped" as const;
      }
      const record = await readRecord(userId);
      return record && { userId, record };
    })
  );
  if (records.some((r) => r === undefined)) return undefined;
  return records.filter(
    (r): r is { userId: string; record: FenceRecord } =>
      r !== undefined && r !== "skipped"
  );
};

/**
 * `userId`'s record, `{}` when it has none, `undefined` when it cannot be
 * read. A record whose bytes are not one is rebuilt from the threads in
 * its folder.
 */
export const readRecord = async (
  userId: string
): Promise<FenceRecord | undefined> => {
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
  report(`read fenced chats of ${userId}: not a record`, new Error("corrupt"));
  return rebuildRecord(userId);
};

/**
 * A record from the thread files in `userId`'s folder, written over one
 * that will never parse. Refusing on it instead, as on a read that
 * failed, refused every thread of every account and failed every `settle`
 * after it for good. The workspaces it named are lost: those threads come
 * back unnamed, each adopted as a workspace of its own.
 */
const rebuildRecord = async (
  userId: string
): Promise<FenceRecord | undefined> => {
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
};

/**
 * Every thread id a fence record names, or `undefined` when the records
 * cannot be read. For the index migration, which must not adopt a fenced
 * thread a lagging tab wrote back: renamed to a fresh id, no record would
 * name it, and the next sign-in would upload it into the arriving account.
 */
export const readFencedIds = async (): Promise<Set<string> | undefined> => {
  const records = await readRecords();
  if (!records) return undefined;
  return new Set(records.flatMap(({ record }) => Object.keys(record)));
};
