import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

/** Which device's lines a hunk decision was about; `none` for typing */
export type HunkSideParam = "this-device" | "other-device" | "none";

/** How a hunk of the resolve view was answered */
export type HunkHowParam = "take" | "dismiss" | "edit";

/** Why an Apply in the resolve view settled nothing */
export type ApplyFailureParam = "refused" | "error";

/** Who found a project over a limit: the client's check, or a 413 */
export type LimitByParam = "client" | "server";

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
   * resolve view or on the banner; `decision` is which.
   */
  sync_whole_file_answered: {
    decision: "keep-local" | "take-server";
    via: "view" | "banner";
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
  /**
   * A project's sync banner was raised for the file size limit (`size`) or
   * the path limit (`path`). `files` is how many files are over it. Once per
   * banner: editing on under it sends nothing more until "Try again" raises
   * it again.
   */
  sync_file_limit_exceeded: {
    by: LimitByParam;
    limit: "size" | "path";
    files: number;
  };
  /**
   * A project's sync banner was raised for the project size limit. `kib` is
   * the project's size in KiB, rounded up. Once per banner, as above.
   */
  sync_project_limit_exceeded: { by: LimitByParam; kib: number };
  /**
   * A project's sync banner was raised for the file count limit. `files` is
   * the counted files. Once per banner, as above.
   */
  sync_files_count_limit_exceeded: { by: LimitByParam; files: number };
  /**
   * A project's sync banner was raised for the account cap: the server
   * refused the write that would make it count (a create, or a swap onto an
   * empty row) because the account already syncs as many projects
   * (`kind: "project"`) or tutorials (`kind: "tutorial"`) as it can.
   * `projects` is the count the refused write would have made. `by` is always
   * `server`, the one side that knows the count. Once per banner, as above.
   */
  sync_projects_count_limit_exceeded: {
    /** Only the server counts an account's projects */
    by: "server";
    kind: "project" | "tutorial";
    projects: number;
  };
};

export const persistenceTelemetry = createTracker<PersistenceEvents>();
