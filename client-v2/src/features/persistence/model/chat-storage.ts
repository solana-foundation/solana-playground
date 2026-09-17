import { decodeThread, encodeThread } from "./chat-codec";
import { clearFailures, getLastFailure, report } from "./diagnostics";
import type { Failure } from "./diagnostics";
import { PgFs } from "../../../utils/explorer/fs";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

/**
 * Whether an error just means "no such file".
 *
 * A thread that has never been written is the ordinary case -- every first
 * read of every conversation -- and reporting it would bury the real faults in
 * noise. Matched on the message as well as the code because the browser
 * filesystem surfaces it both ways.
 */
const isMissing = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  return e?.code === "ENOENT" || !!e?.message?.includes("ENOENT");
};

/** Where threads live, inside the volume that already holds project code */
const DIR = "/.config/chats";

const SUFFIX = ".json";

/**
 * Messages kept per thread.
 *
 * Not a storage limit -- IndexedDB has room for far more. It bounds what a
 * restored thread costs to render, and what a first sync has to upload.
 */
export const MAX_MESSAGES_PER_THREAD = 200;

/**
 * Thread ids become file names, and a tutorial's id carries a colon
 * (`tut:hello-anchor`). Encoding keeps the mapping total and reversible
 * instead of relying on what the backing store happens to tolerate.
 */
const pathOf = (threadId: string) =>
  `${DIR}/${encodeURIComponent(threadId)}${SUFFIX}`;

const threadIdOf = (fileName: string) =>
  decodeURIComponent(fileName.slice(0, -SUFFIX.length));

/**
 * Chat threads on this device.
 *
 * IndexedDB via `PgFs`, not `localStorage`: the origin's ~5MB of
 * `localStorage` is already shared with `settings`, `wallet`, `theme` and
 * `flow.deploys`, and a transcript carrying file diffs does not belong in that
 * budget. Living in the same volume as the code also means one store to reason
 * about, and `.config/` is already a non-workspace directory there.
 *
 * Every method swallows its failures. This is a cache in front of Postgres and
 * a convenience when signed out -- losing a write must never take the panel
 * down with it.
 */
export class PgChatStorage {
  static async read(threadId: string): Promise<ChatItem[]> {
    try {
      const raw = await PgFs.readToString(pathOf(threadId));
      const stored = JSON.parse(raw);
      const items = decodeThread(stored);

      // `decodeThread` is tolerant on purpose, but a dropped item is data the
      // user created going missing with nothing to show for it. Silent here
      // was indistinguishable from the thread having been that short.
      const offered = Array.isArray(stored) ? stored.length : 0;
      if (items.length < offered) {
        report(
          `read ${threadId}: dropped ${
            offered - items.length
          } unreadable item(s)`,
          null
        );
      }
      return items;
    } catch (e) {
      if (!isMissing(e)) report(`read ${threadId}`, e);
      return [];
    }
  }

  static async write(threadId: string, items: readonly ChatItem[]) {
    const capped = items.slice(-MAX_MESSAGES_PER_THREAD);

    try {
      // `createParents` on the write, not a separate `createDir`: that helper
      // treats the last path segment as a file name and stops short of it, so
      // asking it for the directory itself only ever creates `/.config`
      await PgFs.writeFile(
        pathOf(threadId),
        JSON.stringify(encodeThread(capped)),
        { createParents: true }
      );
    } catch (e) {
      report(`write ${threadId}`, e);
    }
  }

  static async remove(threadId: string) {
    try {
      await PgFs.removeFile(pathOf(threadId));
    } catch (e) {
      if (!isMissing(e)) report(`remove ${threadId}`, e);
    }
  }

  static async threadIds(): Promise<string[]> {
    try {
      const names = await PgFs.readDir(DIR);
      return names.filter((name) => name.endsWith(SUFFIX)).map(threadIdOf);
    } catch (e) {
      // No directory yet is the normal state before the first write
      if (!isMissing(e)) report("list threads", e);
      return [];
    }
  }

  /** Drop every thread. Used on sign-out, after a successful final sync. */
  static async clear() {
    try {
      await PgFs.removeDir(DIR, { recursive: true });
    } catch (e) {
      if (!isMissing(e)) report("clear", e);
    }
  }

  /**
   * The most recent failure, or `null`.
   *
   * Exposed so a storage fault can be told apart from an empty conversation
   * from the browser console: `__pgChatStorage.lastFailure`.
   */
  static get lastFailure(): Failure | null {
    return getLastFailure();
  }

  static clearLastFailure() {
    clearFailures();
  }
}
