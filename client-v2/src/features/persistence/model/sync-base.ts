import { report } from "./diagnostics";
import { isUserFile, sha256 } from "./snapshot";
import { isMissing } from "./sync-mark";
import { PgSession } from "../../auth";
import { PgFs } from "../../../utils/explorer/fs";
import type { BaseContents } from "./merge";
import type { FileHashes, Snapshot } from "./snapshot";

/**
 * Next to the marks, not inside their directory: `PgSyncMark.projectIds()`
 * lists every `.json` there as a project this device has synced, and a base
 * file read as a mark is a project "deleted on another device".
 */
const ROOT = "/.config/sync-base";

/** Per account, for the same reason as the marks: tutorial ids are shared */
const pathOf = (userId: string, projectId: string) =>
  `${ROOT}/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}.json`;

const currentUserId = () => PgSession.get()?.id ?? null;

/**
 * What the files this device has edited held at the last agreement.
 *
 * A line-level merge needs three versions of a file, and the base is the one
 * that is gone once the user types: local has overwritten it, and the server
 * may have moved on too. It is only needed for files changed on *both* sides,
 * which were by definition changed here -- so keeping the pre-edit content of
 * locally edited files alone is enough. A file nobody here touched is its own
 * base. In practice the store is empty: every accepted upload clears it.
 *
 * The content comes from the *shadow*, the current workspace's files as of its
 * last open or last accepted upload. Holding it costs nothing but references,
 * since strings are shared, and it spares the explorer a hook: capture runs
 * once per push, off the files the push already knows changed, never per
 * keystroke.
 *
 * With one exception: typing that sync folds into files it has just rewritten
 * is captured on the spot, from what sync wrote. The re-open that follows
 * re-takes the shadow from the folded copy -- the typing included -- so it no
 * longer matches the mark, and every file typed into during a merge or an
 * adoption reached its next merge with no base and was asked about whole.
 *
 * A capture that never happened -- the tab crashed before any push -- is not
 * repaired by guessing. The file is simply asked about, as a whole, which is
 * what every file was before this existed.
 */
export class PgSyncBase {
  static track(projectId: string, files: Record<string, string>) {
    PgSyncBase._shadow = { projectId, files: { ...files } };
  }

  /** Whether a shadow of `projectId` is held, from an open or an upload */
  static isTracking(projectId: string) {
    return PgSyncBase._shadow?.projectId === projectId;
  }

  static async read(projectId: string): Promise<BaseContents> {
    const userId = currentUserId();
    if (!userId) return {};

    try {
      const parsed = JSON.parse(
        await PgFs.readToString(pathOf(userId, projectId))
      );
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        report(`sync base ${projectId}: malformed`, null);
        return {};
      }
      return parsed as BaseContents;
    } catch (e) {
      if (!isMissing(e)) report(`read sync base ${projectId}`, e);
      return {};
    }
  }

  /**
   * Keep the agreed content of `paths`, for those not kept already.
   *
   * Only from a shadow that still *is* the agreement for that file -- its
   * hash has to match the mark. A shadow taken on open after a reload with
   * unpushed edits holds the edit, and keeping that as the base would turn a
   * later merge into a silent revert.
   *
   * @param from where the agreed content is read from, when the caller holds
   * it and the shadow may not: sync folding typing into files it rewrote.
   * Defaults to the shadow.
   */
  static async capture(
    projectId: string,
    paths: readonly string[],
    base: FileHashes,
    from?: Record<string, string>
  ) {
    const shadow = PgSyncBase._shadow;
    const source =
      from ?? (shadow?.projectId === projectId ? shadow.files : null);
    if (!source || !paths.length) return;

    const held = await PgSyncBase.read(projectId);
    let added = false;

    for (const path of paths) {
      if (path in held || !isUserFile(path)) continue;
      const before = source[path];
      const hash = base[path];
      if (before === undefined || hash === undefined) continue;
      if ((await sha256(before)) !== hash) continue;
      held[path] = { hash, content: before };
      added = true;
    }

    if (added) await PgSyncBase.replace(projectId, held);
  }

  static async replace(projectId: string, contents: BaseContents) {
    if (!Object.keys(contents).length) return PgSyncBase.clear(projectId);

    const userId = currentUserId();
    if (!userId) return;
    try {
      await PgFs.writeFile(
        pathOf(userId, projectId),
        JSON.stringify(contents),
        { createParents: true }
      );
    } catch (e) {
      report(`write sync base ${projectId}`, e);
    }
  }

  /**
   * The server took `snapshot`: that is the new agreement, so nothing kept
   * against the old one is a base any more. For the current workspace the
   * accepted copy is also the new shadow -- an edit typed while the upload was
   * in flight is measured from it on the next push.
   */
  static async accepted(
    projectId: string,
    snapshot: Snapshot,
    isCurrent: boolean
  ) {
    await PgSyncBase.clear(projectId);
    if (isCurrent) PgSyncBase.track(projectId, snapshot.files);
  }

  static async clear(projectId: string) {
    const userId = currentUserId();
    if (!userId) return;
    try {
      await PgFs.removeFile(pathOf(userId, projectId));
    } catch (e) {
      if (!isMissing(e)) report(`clear sync base ${projectId}`, e);
    }
  }

  static reset() {
    PgSyncBase._shadow = null;
  }

  private static _shadow: {
    projectId: string;
    files: Record<string, string>;
  } | null = null;
}
