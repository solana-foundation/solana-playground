import { createTracker } from "../../../shared/lib/telemetry";
import type { NoParams } from "../../../shared/lib/telemetry";

/** Which device's lines a hunk decision was about; `none` for typing */
export type HunkSideParam = "this-device" | "other-device" | "none";

/** How a hunk of the resolve view was answered */
export type HunkHowParam = "take" | "dismiss" | "edit";

/** Why an Apply in the resolve view settled nothing */
export type ApplyFailureParam = "refused" | "error";

type PersistenceEvents = {
  /**
   * The resolve view opened on a divergent conflict. `files` is how many
   * files it asks about, `hunks` how many hunks they hold in all (a whole
   * file counts as one).
   */
  sync_resolve_opened: { files: number; hunks: number };
  /**
   * A hunk of the resolve view went from undecided to resolved: by taking or
   * dismissing a side (`side` says whose), or by typing over it (`edit`,
   * `side: "none"`). Undo and redo send nothing.
   */
  sync_resolve_hunk_resolved: { how: HunkHowParam; side: HunkSideParam };
  /** Apply in the resolve view settled the conflict; `files` it answered. */
  sync_resolve_applied: { files: number };
  /** The resolve view was closed without an answer: Cancel, close or Escape. */
  sync_resolve_cancelled: NoParams;
  /**
   * "Keep this version" or "Take the other version" was pressed, in the
   * resolve view or on the banner.
   */
  sync_whole_file_answered: {
    answer: "keep-local" | "take-server";
    from: "view" | "banner";
  };
  /**
   * An Apply was refused because a file changed since the view showed it;
   * the view stays open on the new copies. `files` is how many changed.
   */
  sync_resolve_stale: { files: number };
  /**
   * An Apply settled nothing for another reason: `refused` (the answer came
   * back unsettled with the same copies -- offline, or the workspace gone)
   * or `error` (it threw).
   */
  sync_resolve_apply_failed: { reason: ApplyFailureParam };
};

export const persistenceTelemetry = createTracker<PersistenceEvents>();
