import { isMissing, report } from "./diagnostics";
import { PgSession } from "../../auth";
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

  /** Every project the signed-in account holds a claim for */
  static async projectIds(): Promise<string[]> {
    const userId = currentUserId();
    if (!userId) return [];

    try {
      const names = await PgFs.readDir(dirFor(userId));
      return names.filter((name) => name.endsWith(SUFFIX)).map(projectIdOf);
    } catch (e) {
      if (!isMissing(e)) report("list claims", e);
      return [];
    }
  }
}
