import { report } from "./diagnostics";
import { PgSyncClaim } from "./sync-claim";
// TODO(ui-migration 1.4): a feature importing a feature; marks are stored per signed-in account
import { PgSession } from "@/features/auth";
import { PgFs } from "../../../utils/explorer/fs";
import type { FileHashes } from "./snapshot";
import type { Disposable } from "../../../utils/types";

/** What happened to a mark, for `PgSyncMark.onDidChange` */
export type SyncMarkChange = "written" | "dirtied" | "removed";

/**
 * Whether an error just means "no such file".
 *
 * A project that has never synced has no mark, which is the ordinary case for
 * every project on a device that has just signed in. Same matching as
 * `chat-storage`: the browser filesystem surfaces it as a code and as a
 * message.
 */
export const isMissing = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  return e?.code === "ENOENT" || !!e?.message?.includes("ENOENT");
};

/** Alongside the chat threads, in the volume that already holds the code */
const ROOT = "/.config/sync";

const SUFFIX = ".json";

/**
 * Marks are per account, not per browser.
 *
 * A mark asserts "the server accepted exactly this from me, and the row stood
 * at this timestamp" -- a statement about one account, which says nothing
 * about the next one to sign in here. Sharing a directory would be actively
 * wrong for the case that makes it: a tutorial's id is *derived from its name*
 * and so is byte-identical across accounts, so the previous user's token would
 * be compared against the new user's row and refuse every push.
 *
 * Scoping by id rather than clearing on sign-out also means signing back in is
 * free: the agreements are still there, so nothing re-reconciles from scratch
 * and nothing is re-asked.
 */
const dirFor = (userId: string) => `${ROOT}/${encodeURIComponent(userId)}`;

/** Project ids carry a colon for tutorials, so the mapping has to be total */
const pathOf = (userId: string, projectId: string) =>
  `${dirFor(userId)}/${encodeURIComponent(projectId)}${SUFFIX}`;

const projectIdOf = (fileName: string) =>
  decodeURIComponent(fileName.slice(0, -SUFFIX.length));

/** Who the marks belong to, or `null` when nobody is signed in */
const currentUserId = () => PgSession.get()?.id ?? null;

/** What this device and the server last agreed on, for one project */
export interface SyncMark {
  /**
   * `path -> sha256` of the snapshot the server accepted.
   *
   * Per file because every question sync asks is: which files to upload,
   * which changed on which side, and which can be merged. It is also the base
   * of every merge -- the version both sides started from.
   */
  files: FileHashes;
  /**
   * The name it was stored under.
   *
   * Not everything worth uploading changes the snapshot: a rename sends new
   * `name` under identical bytes. Without this, "has anything changed" had to
   * fall back on `dirty`, which meant any write at all forced an upload --
   * including rewriting a workspace file with the content it already had,
   * which happens on every load.
   */
  name: string;
  /**
   * The local workspace name this agreement maps to, when it is not `name`
   * and sync, not the user, made it so: the server's name was taken here
   * and stepped around (`freeName`), or renaming to it failed. A push
   * sends `name` while the workspace is still called this, so the stand-in
   * never reaches the account; `settleSteppedNames` renames the workspace
   * once the server's name is free. Absent when the two names agree.
   */
  localName?: string;
  /** The row's `updated_at` when it accepted it */
  updatedAt: string;
  /**
   * Set the moment an edit lands, cleared when a push succeeds.
   *
   * Strictly a hint -- `files` is the truth, and reconcile re-hashes anything
   * flagged. It exists so the common case, a device where nothing has changed,
   * costs a handful of small reads instead of re-hashing every project's
   * contents on every reconcile.
   *
   * Set *before* the push is attempted rather than after it fails, so a tab
   * that is closed or crashes between the edit and the upload still reads as
   * dirty on the next load.
   */
  dirty: boolean;
}

/**
 * The high-water mark: what the server had, last time this device agreed.
 *
 * This is the one piece of sync state that has to outlive the page. Without
 * it, a browser that has just loaded cannot tell a local copy that is *behind*
 * the server from one that is *ahead* of it -- both are simply "different" --
 * and every reload has to guess. Guessing in favour of the server is what
 * silently destroyed work that never finished uploading.
 *
 * `PgFs` rather than `localStorage`: the origin's budget there is already
 * shared with `settings`, `wallet`, `theme` and `flow.deploys`, and this is one
 * more file next to the code it describes.
 *
 * Every method but `existsOrThrow` swallows its failures into `diagnostics`.
 * A mark that cannot be read is not a reason to take the panel down; it
 * degrades to "never synced", which reconcile handles. `existsOrThrow` is for
 * a reader that must not take a failed look for "never synced".
 */
export class PgSyncMark {
  /** @returns the mark, or `null` when this project has never synced here */
  static async read(projectId: string): Promise<SyncMark | null> {
    const userId = currentUserId();
    if (!userId) return null;

    try {
      const parsed = JSON.parse(
        await PgFs.readToString(pathOf(userId, projectId))
      );
      const files = parsed?.files;
      if (
        !files ||
        typeof files !== "object" ||
        Array.isArray(files) ||
        !Object.values(files).every((hash) => typeof hash === "string") ||
        typeof parsed?.name !== "string" ||
        typeof parsed?.updatedAt !== "string"
      ) {
        report(`sync mark ${projectId}: malformed`, null);
        return null;
      }
      return {
        files,
        name: parsed.name,
        ...(typeof parsed.localName === "string"
          ? { localName: parsed.localName }
          : {}),
        updatedAt: parsed.updatedAt,
        dirty: parsed.dirty === true,
      };
    } catch (e) {
      if (!isMissing(e)) report(`read sync mark ${projectId}`, e);
      return null;
    }
  }

  /**
   * Drops the project's claim too once the mark is written: the mark says
   * whose it is from here on. Not when the write failed: with neither, the
   * project reads as another account's leftover and never uploads again.
   */
  static write(projectId: string, mark: SyncMark) {
    return PgSyncMark._serial(projectId, async () => {
      if (await PgSyncMark._write(projectId, mark)) {
        await PgSyncClaim.drop(projectId);
        PgSyncMark._emit(projectId, "written");
      }
    });
  }

  /**
   * Fires after a mark of the signed-in account is written, flagged dirty or
   * removed (or found already gone), with which; never for a write or removal
   * that failed. In this tab only. Read-only listeners: the project list's markers
   * (`sync-marker.ts`) re-read on it, and must never write a mark back.
   */
  static onDidChange(
    cb: (projectId: string, change: SyncMarkChange) => void
  ): Disposable {
    PgSyncMark._listeners.add(cb);
    return { dispose: () => PgSyncMark._listeners.delete(cb) };
  }

  private static readonly _listeners = new Set<
    (projectId: string, change: SyncMarkChange) => void
  >();

  private static _emit(projectId: string, change: SyncMarkChange) {
    for (const cb of PgSyncMark._listeners) {
      try {
        cb(projectId, change);
      } catch (e) {
        report(`sync mark listener ${projectId}`, e);
      }
    }
  }

  /**
   * Note that this device has work the server has not seen.
   *
   * A project with no mark is already treated as unsynced, so there is nothing
   * to record for one -- writing a mark here would invent an agreement that
   * never happened.
   *
   * A read and a write back, so it runs in the project's queue with every
   * other change to the mark. Unqueued, a push that wrote its accepted mark
   * between the two was undone -- the old mark came back flagged, and the
   * next push was judged against an agreement the server had moved past.
   */
  static markDirty(projectId: string) {
    return PgSyncMark._serial(projectId, async () => {
      const mark = await PgSyncMark.read(projectId);
      if (!mark || mark.dirty) return;
      if (await PgSyncMark._write(projectId, { ...mark, dirty: true })) {
        PgSyncMark._emit(projectId, "dirtied");
      }
    });
  }

  /** @returns whether the mark was written */
  private static async _write(projectId: string, mark: SyncMark) {
    const userId = currentUserId();
    if (!userId) return false;

    try {
      await PgFs.writeFile(pathOf(userId, projectId), JSON.stringify(mark), {
        createParents: true,
      });
      return true;
    } catch (e) {
      report(`write sync mark ${projectId}`, e);
      return false;
    }
  }

  /** The last change queued per project, while any is outstanding */
  private static readonly _tails = new Map<string, Promise<void>>();

  /**
   * Run `task` after every change to this project's mark queued before it.
   * Settles whatever the task does, so one that throws cannot wedge the
   * queue, and drops the entry once the queue is empty.
   */
  private static _serial(
    projectId: string,
    task: () => Promise<void>
  ): Promise<void> {
    const run = (PgSyncMark._tails.get(projectId) ?? Promise.resolve()).then(
      task
    );
    const tail = run.catch(() => {});
    PgSyncMark._tails.set(projectId, tail);
    void tail.then(() => {
      if (PgSyncMark._tails.get(projectId) === tail) {
        PgSyncMark._tails.delete(projectId);
      }
    });
    return run;
  }

  /**
   * Whether this device has any record of syncing this project for the
   * signed-in account -- in any shape, readable or not.
   *
   * The question `projectIds` answers per project. A mark `read` cannot use
   * is still the difference between "deleted elsewhere" and "never uploaded".
   */
  static async exists(projectId: string): Promise<boolean> {
    try {
      return await PgSyncMark.existsOrThrow(projectId);
    } catch (e) {
      report(`find sync mark ${projectId}`, e);
      return false;
    }
  }

  /**
   * `exists`, rejecting when the store cannot say. For a reader that must not
   * take a failed look for "never synced": the project list's marker would
   * otherwise tell the person the account lacks a project it holds.
   */
  static async existsOrThrow(projectId: string): Promise<boolean> {
    const userId = currentUserId();
    if (!userId) return false;
    return await PgFs.exists(pathOf(userId, projectId));
  }

  /**
   * Queued like a write, so a flag already reading it cannot bring it back.
   * Drops the claim too: left behind, it would vouch for another account's
   * project that later turns up under the same id.
   */
  static remove(projectId: string) {
    return PgSyncMark._serial(projectId, async () => {
      const userId = currentUserId();
      if (!userId) return;

      let gone = true;
      try {
        await PgFs.removeFile(pathOf(userId, projectId));
      } catch (e) {
        if (!isMissing(e)) {
          gone = false;
          report(`remove sync mark ${projectId}`, e);
        }
      }
      await PgSyncClaim.drop(projectId);
      if (gone) PgSyncMark._emit(projectId, "removed");
    });
  }

  /**
   * Every project this device has ever synced for the signed-in account.
   *
   * Reconcile needs this to spot the projects the server *no longer* lists: a
   * mark with no server row is a project deleted on another device, which is a
   * different thing from a project that was never uploaded.
   */
  static async projectIds(): Promise<string[]> {
    const userId = currentUserId();
    if (!userId) return [];

    try {
      const names = await PgFs.readDir(dirFor(userId));
      return names.filter((name) => name.endsWith(SUFFIX)).map(projectIdOf);
    } catch (e) {
      if (!isMissing(e)) report("list sync marks", e);
      return [];
    }
  }

  /**
   * Whether some *other* account on this browser has synced this project.
   *
   * Local workspaces are not account-scoped -- they predate accounts, and
   * signing out does not clear them -- so the next user to sign in here sees
   * the previous user's projects in the explorer. Handing those to the account
   * that happens to be signed in now would copy one person's work into
   * another's, and a mark under another user's id is the record that says
   * whose it was.
   *
   * A project with no mark anywhere is a different thing: made locally, never
   * synced by anyone, and so fair game for whoever signs in.
   */
  static async ownedByAnother(projectId: string): Promise<boolean> {
    const userId = currentUserId();

    try {
      for (const owner of await PgFs.readDir(ROOT)) {
        if (owner === (userId && encodeURIComponent(userId))) continue;
        if (await PgFs.exists(pathOf(decodeURIComponent(owner), projectId))) {
          return true;
        }
      }
      return false;
    } catch (e) {
      if (!isMissing(e)) report(`owners of ${projectId}`, e);
      return false;
    }
  }

  /**
   * Whether a project on this browser is another account's, and so must not
   * be uploaded into the one signed in: this account has no mark for it,
   * readable or not, and no claim (`PgSyncClaim`), while another account has a
   * mark. Without the claim, a tutorial this account started here under the
   * id another account's copy had would read as that account's leftover.
   */
  static async belongsToAnotherAccount(projectId: string): Promise<boolean> {
    return (
      !(await PgSyncMark.exists(projectId)) &&
      !(await PgSyncClaim.has(projectId)) &&
      (await PgSyncMark.ownedByAnother(projectId))
    );
  }

  /** Drop this account's marks. Test seam, and a way out of a wedged state. */
  static async clear() {
    const userId = currentUserId();
    if (!userId) return;

    try {
      await PgFs.removeDir(dirFor(userId), { recursive: true });
    } catch (e) {
      if (!isMissing(e)) report("clear sync marks", e);
    }
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach } = import.meta.vitest;

  describe("features/persistence/model/sync-mark", () => {
    const storedFiles = () =>
      (PgFs as unknown as { __files: Map<string, string> }).__files;

    describe("PgSyncMark", () => {
      beforeEach(async () => {
        PgSession.reset();
        storedFiles().clear();
        await PgSession.refreshWith({
          id: "u1",
          name: null,
          image: null,
          login: null,
        });
      });

      it("round-trips per-file hashes", async () => {
        const mark = {
          files: { a: "h1" },
          name: "one",
          updatedAt: "t1",
          dirty: false,
        };
        await PgSyncMark.write("p1", mark);
        expect(await PgSyncMark.read("p1")).toEqual(mark);
      });

      it("drops the claim when it writes the mark, by any path", async () => {
        // A merge or an adopt writes the mark without a first push; a claim left
        // behind would later vouch for another account's project under this id
        await PgSyncClaim.claim("tut:hello");

        await PgSyncMark.write("tut:hello", {
          files: { a: "h1" },
          name: "one",
          updatedAt: "t1",
          dirty: false,
        });

        expect(await PgSyncClaim.has("tut:hello")).toBe(false);
      });

      it("keeps the claim when the mark could not be written", async () => {
        // Neither a mark nor a claim reads as another account's leftover, and
        // the tutorial would never upload again
        await PgSyncClaim.claim("tut:hello");
        vi.spyOn(PgFs, "writeFile").mockRejectedValueOnce(new Error("quota"));

        await PgSyncMark.write("tut:hello", {
          files: { a: "h1" },
          name: "one",
          updatedAt: "t1",
          dirty: false,
        });

        expect(await PgSyncMark.exists("tut:hello")).toBe(false);
        expect(await PgSyncClaim.has("tut:hello")).toBe(true);
      });

      it("drops the claim when it removes the mark", async () => {
        await PgSyncClaim.claim("tut:hello");

        await PgSyncMark.remove("tut:hello");

        expect(await PgSyncClaim.has("tut:hello")).toBe(false);
      });

      it("reads a mark without per-file hashes as never agreed, yet as existing", async () => {
        // Unreadable as an agreement, but still the record that this device
        // synced the project -- the difference between "deleted elsewhere" and
        // "never uploaded"
        storedFiles().set(
          "/.config/sync/u1/p1.json",
          JSON.stringify({ name: "one", updatedAt: "t1", dirty: false })
        );
        expect(await PgSyncMark.read("p1")).toBeNull();
        expect(await PgSyncMark.exists("p1")).toBe(true);
        expect(await PgSyncMark.exists("p2")).toBe(false);
      });

      it("refuses a file map that is not strings", async () => {
        storedFiles().set(
          "/.config/sync/u1/p1.json",
          JSON.stringify({
            files: { a: 1 },
            name: "one",
            updatedAt: "t1",
            dirty: false,
          })
        );
        expect(await PgSyncMark.read("p1")).toBeNull();
      });

      describe("one project's writes, one at a time", () => {
        const old = {
          files: { a: "old" },
          name: "one",
          updatedAt: "t1",
          dirty: false,
        };
        const fresh = { ...old, files: { a: "new" }, updatedAt: "t2" };

        it("does not put back the mark a push replaced while flagging it dirty", async () => {
          // `markDirty` reads the mark and writes it back flagged. A push that
          // wrote its accepted mark in between was undone by it: the old mark
          // came back, and the next push was judged against an agreement the
          // server had already moved past -- a prompt about nothing.
          await PgSyncMark.write("p1", old);

          const flagging = PgSyncMark.markDirty("p1");
          const pushed = PgSyncMark.write("p1", fresh);
          await Promise.all([flagging, pushed]);

          expect(await PgSyncMark.read("p1")).toEqual(fresh);
        });

        it("flags the mark a push wrote, when the flag comes after it", async () => {
          await PgSyncMark.write("p1", old);

          const pushed = PgSyncMark.write("p1", fresh);
          const flagging = PgSyncMark.markDirty("p1");
          await Promise.all([pushed, flagging]);

          expect(await PgSyncMark.read("p1")).toEqual({
            ...fresh,
            dirty: true,
          });
        });

        it("does not bring back a removed mark", async () => {
          await PgSyncMark.write("p1", old);

          const flagging = PgSyncMark.markDirty("p1");
          const removing = PgSyncMark.remove("p1");
          await Promise.all([flagging, removing]);

          expect(await PgSyncMark.exists("p1")).toBe(false);
        });

        it("keeps going after a write that failed", async () => {
          const writeFile = vi
            .spyOn(PgFs, "writeFile")
            .mockRejectedValueOnce(new Error("quota"));
          await PgSyncMark.write("p1", old);
          writeFile.mockRestore();

          await PgSyncMark.write("p1", fresh);
          expect(await PgSyncMark.read("p1")).toEqual(fresh);
        });
      });
    });
  });
}
