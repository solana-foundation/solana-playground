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
 * The id of the notice that stands in for what this device dropped.
 *
 * Derived from the thread id and therefore stable: a rewrite replaces the same
 * item instead of stacking a second one, and the two devices that both
 * truncate the same thread agree on the id rather than each contributing one.
 */
export const truncationNoticeId = (threadId: string) => `truncated:${threadId}`;

/**
 * Drop the truncation notice from a thread.
 *
 * The cap is this device's, not the conversation's -- the server keeps every
 * message -- so the notice must not travel with a thread being uploaded, or a
 * second device would be told that messages it can still see are gone.
 */
export const withoutTruncationNotice = (items: readonly ChatItem[]) =>
  items.filter((item) => !item.id.startsWith("truncated:"));

/**
 * Deliberately carries no count. The number is unknowable on any write after
 * the first -- by then the dropped messages are gone -- and a notice whose
 * text never changes is one a rewrite can reproduce exactly.
 */
const truncationNotice = (threadId: string): ChatItem => ({
  kind: "notice",
  id: truncationNoticeId(threadId),
  // Ahead of everything it stands for, so it sorts to the top of the thread
  createdAt: new Date(0).toISOString(),
  text: "Earlier messages in this conversation are not kept on this device.",
});

/**
 * Bound a thread to the newest `limit` items, the truncation notice included.
 *
 * The notice is re-derived rather than carried through, so a thread that has
 * been truncated before keeps saying so even once the rest fits again. An
 * existing notice object is reused, so capping a thread that is already capped
 * hands back the very same items -- which is how the store tells that a fold
 * changed nothing.
 *
 * @param limit the most items to keep; the store passes more than the cap so
 * a fold never trims what a running session already shows
 */
export const capThread = (
  threadId: string,
  items: readonly ChatItem[],
  limit = MAX_MESSAGES_PER_THREAD
): ChatItem[] => {
  const real = withoutTruncationNotice(items);
  const truncated = real.length > limit || real.length < items.length;
  if (!truncated) return real;

  // Past the limit one slot goes to the notice, so one more message makes way
  const noticeId = truncationNoticeId(threadId);
  const notice =
    items.find((item) => item.id === noticeId) ?? truncationNotice(threadId);
  return [notice, ...real.slice(-(limit - 1))];
};

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
  /**
   * @returns the thread, `[]` when it has never been written, or **`null`**
   * when this device could not tell you.
   *
   * The third answer is the point. Returning `[]` for a file that failed to
   * read made "there is nothing here" and "I could not look" the same value,
   * and sign-out deletes local threads on the strength of the first -- so an
   * unreadable thread was reported as uploaded and then removed, which is the
   * one case where the file was worth keeping by hand.
   */
  static async read(threadId: string): Promise<ChatItem[] | null> {
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
      // A thread that has never been written is the ordinary case -- every
      // first read of every conversation -- and is genuinely empty
      if (isMissing(e)) return [];

      report(`read ${threadId}`, e);
      return null;
    }
  }

  static async write(threadId: string, items: readonly ChatItem[]) {
    const capped = capThread(threadId, items);

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

  /**
   * @returns whether the file is gone, which a file that was never there
   * is. A failure is reported here; the caller only decides whether to go on.
   */
  static async remove(threadId: string): Promise<boolean> {
    try {
      await PgFs.removeFile(pathOf(threadId));
      return true;
    } catch (e) {
      if (isMissing(e)) return true;
      report(`remove ${threadId}`, e);
      return false;
    }
  }

  /**
   * @returns every thread on this device, `[]` before the first one is
   * written, or **`null`** when they could not be enumerated.
   *
   * Same distinction as `read`, and it mattered more here: `pushAll` reduced
   * this with `.every(Boolean)`, and `[].every(Boolean)` is `true`. A failed
   * enumeration therefore answered "all of them uploaded" and sign-out
   * cleared the directory.
   */
  static async threadIds(): Promise<string[] | null> {
    try {
      const names = await PgFs.readDir(DIR);
      return (
        names
          .filter((name) => name.endsWith(SUFFIX))
          .map(threadIdOf)
          // `index.json` lives in this directory too and is not a thread; see
          // `thread-index.ts` for what it holds
          .filter((id) => id !== "index")
      );
    } catch (e) {
      // No directory yet is the normal state before the first write
      if (isMissing(e)) return [];

      report("list threads", e);
      return null;
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

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach } = import.meta.vitest;

  describe("features/persistence/model/chat-storage", () => {
    /** The mock's own store, for corrupting a file or asserting on one */
    const mockFiles = (PgFs as unknown as { __files: Map<string, string> })
      .__files;

    beforeEach(() => mockFiles.clear());

    const item = (n: number): ChatItem => ({
      kind: "user",
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      createdAt: new Date(n * 1000).toISOString(),
      text: `m${n}`,
    });

    describe("PgChatStorage", () => {
      it("round-trips a thread", async () => {
        await PgChatStorage.write("t1", [item(1), item(2)]);

        expect(await PgChatStorage.read("t1")).toEqual([item(1), item(2)]);
      });

      it("keeps threads apart", async () => {
        await PgChatStorage.write("t1", [item(1)]);
        await PgChatStorage.write("t2", [item(2)]);

        expect(await PgChatStorage.read("t1")).toEqual([item(1)]);
        expect(await PgChatStorage.read("t2")).toEqual([item(2)]);
      });

      it("returns an empty thread for an unknown id", async () => {
        expect(await PgChatStorage.read("nope")).toEqual([]);
      });

      it("handles a tutorial id, which is not a plain file name", async () => {
        // `tut:hello-anchor` carries a colon, and thread ids become file names
        await PgChatStorage.write("tut:hello-anchor", [item(1)]);

        expect(await PgChatStorage.read("tut:hello-anchor")).toEqual([item(1)]);
        expect(await PgChatStorage.threadIds()).toContain("tut:hello-anchor");
      });

      it("keeps only the newest messages past the per-thread cap", async () => {
        const many = Array.from(
          { length: MAX_MESSAGES_PER_THREAD + 10 },
          (_, i) => item(i)
        );

        await PgChatStorage.write("t1", many);

        const read = (await PgChatStorage.read("t1"))!;
        expect(read).toHaveLength(MAX_MESSAGES_PER_THREAD);
        expect(read[read.length - 1]).toEqual(many[many.length - 1]);
        // One slot goes to the notice saying the rest is gone
        expect(read[1]).toEqual(many[11]);
      });

      describe("the truncation notice", () => {
        const many = (n: number) =>
          Array.from({ length: n }, (_, i) => item(i));

        it("says so at the top when messages were dropped", async () => {
          await PgChatStorage.write("t1", many(MAX_MESSAGES_PER_THREAD + 1));

          const read = (await PgChatStorage.read("t1"))!;
          expect(read[0]).toMatchObject({
            kind: "notice",
            id: truncationNoticeId("t1"),
          });
          expect(read[0]).toHaveProperty(
            "text",
            expect.stringMatching(/not kept/i)
          );
        });

        it("stays out of a thread that fits", async () => {
          await PgChatStorage.write("t1", many(MAX_MESSAGES_PER_THREAD));

          const read = (await PgChatStorage.read("t1"))!;
          expect(read.some((i) => i.kind === "notice")).toBe(false);
        });

        it("is not duplicated when a truncated thread is written back", async () => {
          await PgChatStorage.write("t1", many(MAX_MESSAGES_PER_THREAD + 10));
          const once = (await PgChatStorage.read("t1"))!;

          await PgChatStorage.write("t1", once);
          const twice = (await PgChatStorage.read("t1"))!;

          expect(twice.filter((i) => i.kind === "notice")).toHaveLength(1);
          expect(twice[0]).toMatchObject({ id: truncationNoticeId("t1") });
        });

        it("survives a rewrite whose remainder now fits", async () => {
          // The messages are still gone; only the count fits under the cap now
          await PgChatStorage.write("t1", many(MAX_MESSAGES_PER_THREAD + 10));
          const truncated = (await PgChatStorage.read("t1"))!;

          await PgChatStorage.write("t1", truncated);

          const read = (await PgChatStorage.read("t1"))!;
          expect(read[0]).toMatchObject({ id: truncationNoticeId("t1") });
        });

        it("goes away on a thread that never carried it", async () => {
          await PgChatStorage.write("t1", many(3));

          const read = (await PgChatStorage.read("t1"))!;
          expect(read.some((i) => i.kind === "notice")).toBe(false);
        });

        it("is local, so a thread on its way to the server never carries it", () => {
          // The server keeps every message; only this device drops the old ones
          const withNotice = [
            {
              kind: "notice" as const,
              id: truncationNoticeId("t1"),
              createdAt: "2026-01-01T00:00:00.000Z",
              text: "x",
            },
            item(1),
          ];

          expect(withoutTruncationNotice(withNotice)).toEqual([item(1)]);
        });
      });

      it("lists and removes threads", async () => {
        await PgChatStorage.write("t1", [item(1)]);
        await PgChatStorage.write("t2", [item(2)]);

        expect((await PgChatStorage.threadIds())!.sort()).toEqual(["t1", "t2"]);

        await PgChatStorage.remove("t1");

        expect(await PgChatStorage.threadIds()).toEqual(["t2"]);
        expect(await PgChatStorage.read("t1")).toEqual([]);
      });

      it("survives a hand-corrupted file rather than losing the panel", async () => {
        // Still does not throw -- the panel keeps working. It answers `null`
        // rather than `[]` so that callers which *delete* on "there is nothing
        // here" can tell the two apart; the panel itself renders either as empty.
        await PgChatStorage.write("t1", [item(1)]);
        mockFiles.set("/.config/chats/t1.json", "{ not json");

        await expect(PgChatStorage.read("t1")).resolves.toBeNull();
      });

      describe("failure reporting", () => {
        // Every method still catches -- losing a write must not take the panel
        // down -- but "it broke" must be distinguishable from "there is nothing
        // here", or a storage fault looks exactly like an empty conversation.
        beforeEach(() => PgChatStorage.clearLastFailure());

        it("says nothing about a thread that simply does not exist", async () => {
          expect(await PgChatStorage.read("never-written")).toEqual([]);
          expect(PgChatStorage.lastFailure).toBeNull();
        });

        it("answers null for a read that failed, rather than an empty thread", async () => {
          // The distinction the callers need: `[]` means "this conversation is
          // empty", `null` means "this device could not tell you". Sign-out
          // deletes local threads once they are safely uploaded, and the second
          // answer read as the first is how it deletes one it never uploaded.
          await PgChatStorage.write("t1", [item(1)]);
          mockFiles.set("/.config/chats/t1.json", "{ not json");

          expect(await PgChatStorage.read("t1")).toBeNull();
          expect(PgChatStorage.lastFailure?.what).toMatch(/read t1/);
        });

        it("answers null when the threads cannot be enumerated", async () => {
          const spy = vi
            .spyOn(PgFs, "readDir")
            .mockRejectedValueOnce(new Error("quota"));

          expect(await PgChatStorage.threadIds()).toBeNull();
          expect(PgChatStorage.lastFailure?.what).toMatch(/list threads/);
          spy.mockRestore();
        });

        it("still answers empty for a directory that is simply not there yet", async () => {
          // The ordinary state before the first message is ever written
          expect(await PgChatStorage.threadIds()).toEqual([]);
          expect(PgChatStorage.lastFailure).toBeNull();
        });

        it("records a write that failed", async () => {
          const spy = vi
            .spyOn(PgFs, "writeFile")
            .mockRejectedValueOnce(new Error("quota"));

          await PgChatStorage.write("t1", [item(1)]);

          expect(PgChatStorage.lastFailure?.what).toMatch(/write t1/);
          spy.mockRestore();
        });

        it("records items dropped as unreadable, which are otherwise invisible", async () => {
          await PgChatStorage.write("t1", [item(1)]);
          mockFiles.set(
            "/.config/chats/t1.json",
            JSON.stringify([item(1), { kind: "bogus", id: "x" }])
          );

          expect(await PgChatStorage.read("t1")).toHaveLength(1);
          expect(PgChatStorage.lastFailure?.what).toMatch(/dropped/);
        });
      });

      it("does not throw when the write fails", async () => {
        // Losing a write must never take the panel down with it
        const spy = vi
          .spyOn(PgFs, "writeFile")
          .mockRejectedValueOnce(new Error("quota"));

        await expect(
          PgChatStorage.write("t1", [item(1)])
        ).resolves.toBeUndefined();

        spy.mockRestore();
      });

      it("clears every thread it owns", async () => {
        await PgChatStorage.write("t1", [item(1)]);
        await PgChatStorage.write("t2", [item(2)]);

        await PgChatStorage.clear();

        expect(await PgChatStorage.threadIds()).toEqual([]);
      });

      it("encodes patch approvals on the way in", async () => {
        const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join(
          "\n"
        );
        const approval: ChatItem = {
          kind: "approval",
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "pending",
          request: {
            type: "patch",
            path: "src/lib.rs",
            before: big,
            after: big.replace("line 100", "changed"),
          },
        };

        await PgChatStorage.write("t1", [approval]);

        const [read] = (await PgChatStorage.read("t1"))!;
        if (read.kind !== "approval" || read.request.type !== "patch") {
          throw new Error("expected a stored patch approval");
        }
        // Trimmed to the changed region, and a pending card cannot be resumed so
        // it is stored as unanswered rather than left spinning
        expect(read.request.before!.length).toBeLessThan(big.length / 4);
        expect(read.status).toBe("unanswered");
      });
    });
  });
}
