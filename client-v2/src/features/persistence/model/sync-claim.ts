import { isMissing, report } from "./diagnostics";
// TODO(ui-migration 1.4): a feature importing a feature; a claim is kept per signed-in account
import { PgSession } from "@/features/auth";
import { PgFs } from "../../../utils/explorer/fs";

/**
 * Next to the marks, not inside their directory: `PgSyncMark.projectIds()`
 * lists every `.json` there as a project this device has synced.
 */
const ROOT = "/.config/sync-claims";

const SUFFIX = ".json";

/** Per account, for the same reason as the marks: tutorial ids are shared */
const dirFor = (userId: string) => `${ROOT}/${encodeURIComponent(userId)}`;

const pathOf = (userId: string, projectId: string) =>
  `${dirFor(userId)}/${encodeURIComponent(projectId)}${SUFFIX}`;

const projectIdOf = (fileName: string) =>
  decodeURIComponent(fileName.slice(0, -SUFFIX.length));

const currentUserId = () => PgSession.get()?.id ?? null;

/**
 * Which account created a workspace on this browser, until its first upload.
 *
 * A tutorial's id is derived from its name, so it is the same for every
 * account. Another account's mark for a project this account has none for
 * usually means a project that account left here, which must not be uploaded
 * into this one -- but it equally fits this account starting the same
 * tutorial after the other one released its copy. The claim tells the two
 * apart. `PgSyncMark` drops it whenever it writes or removes this account's
 * mark, and `settleLocalDeletes` once the workspace is gone, so a claim never
 * outlives the workspace it was made for.
 *
 * Only a workspace created while signed in is claimed. One created signed
 * out, under an id another account synced here, stays unuploaded: nothing on
 * this browser can say whose it is.
 */
export class PgSyncClaim {
  static async claim(projectId: string) {
    const userId = currentUserId();
    if (!userId) return;

    try {
      await PgFs.writeFile(pathOf(userId, projectId), "{}", {
        createParents: true,
      });
    } catch (e) {
      report(`claim ${projectId}`, e);
    }
  }

  static async has(projectId: string): Promise<boolean> {
    const userId = currentUserId();
    if (!userId) return false;

    try {
      return await PgFs.exists(pathOf(userId, projectId));
    } catch (e) {
      report(`find claim ${projectId}`, e);
      return false;
    }
  }

  static async drop(projectId: string) {
    const userId = currentUserId();
    if (!userId) return;

    try {
      await PgFs.removeFile(pathOf(userId, projectId));
    } catch (e) {
      if (!isMissing(e)) report(`drop claim ${projectId}`, e);
    }
  }

  /**
   * Every project any account on this browser holds a claim for, signed in
   * or not.
   *
   * A workspace can be deleted while signed out, or while another account is
   * signed in, and its claim has to go with it all the same. Listed for the
   * signed-in account alone, the claim of a tutorial deleted after its
   * account signed out survived, and later vouched for the next account's
   * leftover copy under the same id.
   */
  static async projectIds(): Promise<string[]> {
    try {
      const ids = new Set<string>();
      for (const owner of await PgSyncClaim._owners()) {
        const names = await PgFs.readDir(dirFor(owner));
        for (const name of names) {
          if (name.endsWith(SUFFIX)) ids.add(projectIdOf(name));
        }
      }
      return [...ids];
    } catch (e) {
      if (!isMissing(e)) report("list claims", e);
      return [];
    }
  }

  /** Drop every account's claim, for a workspace that no longer exists */
  static async forget(projectId: string) {
    try {
      for (const owner of await PgSyncClaim._owners()) {
        try {
          await PgFs.removeFile(pathOf(owner, projectId));
        } catch (e) {
          if (!isMissing(e)) throw e;
        }
      }
    } catch (e) {
      if (!isMissing(e)) report(`forget claim ${projectId}`, e);
    }
  }

  private static async _owners(): Promise<string[]> {
    return (await PgFs.readDir(ROOT)).map(decodeURIComponent);
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach } = import.meta.vitest;

  describe("features/persistence/model/sync-claim", () => {
    const storedFiles = () =>
      (PgFs as unknown as { __files: Map<string, string> }).__files;

    const signIn = (id: string) =>
      PgSession.refreshWith({ id, name: null, image: null, login: null });

    beforeEach(() => {
      PgSession.reset();
      storedFiles().clear();
    });

    it("lists every account's claims, signed out too", async () => {
      await signIn("u1");
      await PgSyncClaim.claim("tut:one");
      await signIn("u2");
      await PgSyncClaim.claim("tut:two");
      await PgSession.refreshWith(null);

      expect((await PgSyncClaim.projectIds()).sort()).toEqual([
        "tut:one",
        "tut:two",
      ]);
    });

    it("forgets a deleted workspace's claim for whichever account made it", async () => {
      // Deleted after its account signed out: the claim must not outlive it
      // and vouch for the next account's copy under the same id
      await signIn("u1");
      await PgSyncClaim.claim("tut:hello");
      await PgSession.refreshWith(null);

      await PgSyncClaim.forget("tut:hello");

      await signIn("u1");
      expect(await PgSyncClaim.has("tut:hello")).toBe(false);
    });

    it("lists nothing, and reports nothing, before any claim", async () => {
      expect(await PgSyncClaim.projectIds()).toEqual([]);
      await expect(PgSyncClaim.forget("tut:hello")).resolves.toBeUndefined();
    });
  });
}
