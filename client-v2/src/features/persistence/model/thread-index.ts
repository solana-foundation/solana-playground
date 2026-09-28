import { validate as isUuid } from "uuid";

import { report } from "./diagnostics";
import { uuid } from "./ids";
import { PgFs } from "../../../utils/explorer/fs";

/**
 * Which conversation is open on which workspace.
 *
 * A thread has an id of its own, so that a project can hold more than one --
 * the schema has said so since the first migration, and the panel would
 * otherwise have to be rewritten, with live data underneath it, the day a
 * thread picker arrives. What a workspace has is an *active* thread, and that
 * is this file: a small map beside the threads themselves.
 *
 * Kept separate from `PgChatStorage` because it answers a different question.
 * Storage knows what is in a thread; this knows which thread to open.
 */

/** Where threads live, inside the volume that already holds project code */
const DIR = "/.config/chats";

/** The map, beside the threads it points at */
const INDEX_PATH = `${DIR}/index.json`;

const SUFFIX = ".json";

/** Workspace id -> the thread currently open on it */
type Index = Record<string, string>;

/**
 * Whether an error just means "no such file".
 *
 * Matched on the message as well as the code because the browser filesystem
 * surfaces it both ways.
 */
const isMissing = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  return e?.code === "ENOENT" || !!e?.message?.includes("ENOENT");
};

const pathOf = (threadId: string) =>
  `${DIR}/${encodeURIComponent(threadId)}${SUFFIX}`;

const nameToId = (fileName: string) =>
  decodeURIComponent(fileName.slice(0, -SUFFIX.length));

export class PgThreadIndex {
  /** The whole map, workspace id to thread id */
  static async all(): Promise<Index> {
    await PgThreadIndex._migrateOnce();
    return (
      PgThreadIndex._cache ??
      (PgThreadIndex._cache = await PgThreadIndex._read())
    );
  }

  /** Which thread is open on this workspace, or `null` if it has none yet */
  static async get(workspaceId: string): Promise<string | null> {
    return (await PgThreadIndex.all())[workspaceId] ?? null;
  }

  /**
   * The thread open on this workspace, minting one if it has never had a
   * conversation.
   *
   * Minted on the client, like every message id: two devices that both do
   * this offline produce two threads rather than one contested one, which is
   * the trade the schema already accepts.
   */
  static async ensure(workspaceId: string): Promise<string> {
    await PgThreadIndex.all();
    return PgThreadIndex._mint(workspaceId);
  }

  /**
   * `ensure`, without the wait -- `null` when the map has not been read yet.
   *
   * Opening a conversation has to be able to happen *synchronously* on a
   * workspace switch. A message sent in the gap before a thread is open is
   * only in memory: it is adopted by the thread when one opens, but a reload
   * inside that window loses it, because nothing has been written down yet.
   * Awaiting an IndexedDB read on the way in makes that window hundreds of
   * milliseconds wide instead of none.
   *
   * So the map is read once, early (`warm`), and from then on the answer is
   * available on the spot. Minting is immediate too: the id is returned now
   * and the map is written behind it, because the id is what the caller needs
   * and the write only has to survive the tab.
   */
  static ensureSync(workspaceId: string): string | null {
    return PgThreadIndex._cache ? PgThreadIndex._mint(workspaceId) : null;
  }

  /** Read the map into memory, so `ensureSync` can answer */
  static warm() {
    void PgThreadIndex.all();
  }

  /** Which workspace a thread belongs to, for a push that must name one */
  static async workspaceOf(threadId: string): Promise<string | null> {
    const index = await PgThreadIndex.all();
    const found = Object.entries(index).find(([, id]) => id === threadId);
    return found?.[0] ?? null;
  }

  /**
   * Point a workspace at a different thread.
   *
   * Used by sign-in to point a workspace at the account's thread, and what a
   * thread picker will use.
   *
   * Spreads the cache as it is at write time, not the map read before the
   * `await`: sign-in repoints several workspaces at once, and spreading a
   * snapshot let each write undo the one before it.
   */
  static async set(workspaceId: string, threadId: string) {
    await PgThreadIndex.all();
    await PgThreadIndex._write({
      ...PgThreadIndex._cache,
      [workspaceId]: threadId,
    });
  }

  /**
   * Drop what is held in memory, so the next read goes to storage.
   *
   * This map is read on the way into every conversation and on every push, so
   * it is kept in memory rather than re-read from IndexedDB each time -- the
   * cost of a read there is small but it sits directly in front of opening a
   * thread, and a project switch is where that is most visible.
   */
  static reload() {
    PgThreadIndex._cache = null;
    PgThreadIndex._migrated = null;
  }

  /** Forget everything. Sign-out clears the whole directory with it. */
  static async clear() {
    PgThreadIndex.reload();
    try {
      await PgFs.removeFile(INDEX_PATH);
    } catch (e) {
      if (!isMissing(e)) report("clear index", e);
    }
  }

  /** The map as last read or written; `null` until the first read */
  private static _cache: Index | null = null;

  /**
   * The adoption pass, run once per load.
   *
   * Held as the promise rather than a flag so two reads arriving together
   * share one pass instead of both renaming the same file.
   */
  private static _migrated: Promise<void> | null = null;

  /** The thread on this workspace, minting and recording one if it has none */
  private static _mint(workspaceId: string): string {
    const index = PgThreadIndex._cache ?? {};
    const existing = index[workspaceId];
    if (existing) return existing;

    const threadId = uuid();
    // Not awaited: `_write` sets the cache before it touches storage, so the
    // next caller sees this thread whether or not the write has landed
    void PgThreadIndex._write({ ...index, [workspaceId]: threadId });
    return threadId;
  }

  private static async _read(): Promise<Index> {
    try {
      const parsed = JSON.parse(await PgFs.readToString(INDEX_PATH));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      // Hand-editable JSON in the user's own browser storage: one bad entry
      // must cost that entry, not every workspace's conversation
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          ([, id]) => typeof id === "string" && isUuid(id)
        )
      ) as Index;
    } catch (e) {
      if (!isMissing(e)) report("read index", e);
      return {};
    }
  }

  private static async _write(index: Index) {
    PgThreadIndex._cache = index;
    try {
      await PgFs.writeFile(INDEX_PATH, JSON.stringify(index), {
        createParents: true,
      });
    } catch (e) {
      report("write index", e);
    }
  }

  /**
   * Give thread files that are named after a workspace an id of their own.
   *
   * Before threads had ids, a thread file *was* the workspace id --
   * `tut:hello-anchor.json`, or a project's uuid. Both still have to open
   * after an update, so on the first read each such file is renamed to a
   * freshly minted thread id and recorded in the index.
   *
   * Runs once per load and is idempotent anyway: a file the index already
   * points at is left alone, so the only thing it ever adopts is a file
   * nothing can open. A project's own id is a uuid too, so the file name
   * cannot tell the two apart -- which is why the index, not the name, is
   * what decides.
   */
  private static async _migrateOnce() {
    PgThreadIndex._migrated ??= PgThreadIndex._migrate();
    return PgThreadIndex._migrated;
  }

  private static async _migrate() {
    let names: string[];
    try {
      names = await PgFs.readDir(DIR);
    } catch (e) {
      // No directory yet is the normal state before the first conversation
      if (!isMissing(e)) report("list threads", e);
      return;
    }

    const index = await PgThreadIndex._read();
    const known = new Set(Object.values(index));
    let changed = false;

    for (const name of names) {
      if (!name.endsWith(SUFFIX)) continue;

      const id = nameToId(name);
      if (id === "index" || known.has(id)) continue;

      // Not in the index, so this file is named after its workspace whatever
      // the name looks like
      const threadId = uuid();
      try {
        await PgFs.rename(`${DIR}/${name}`, pathOf(threadId));
      } catch (e) {
        report(`migrate ${id}`, e);
        continue;
      }
      index[id] = threadId;
      known.add(threadId);
      changed = true;
    }

    if (changed) await PgThreadIndex._write(index);
  }
}
