import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

/** Why a share did not end in a gist */
export type GistExportFailure =
  | "too-large"
  | "signed-out"
  | "sign-in-failed"
  | "needs-gist-scope"
  | "github-unauthorized"
  | "rate-limited"
  | "rejected"
  | "request-failed"
  | "read-failed";

/** Whether a shared gist is listed on the user's GitHub profile */
export type GistVisibility = "secret" | "public";

/** Where the share dialog was opened: the frame's header, or the open project's row menu */
export type GistShareSource = "header" | "project_menu";

/** Which link a copy in the shared state put on the clipboard */
export type GistCopiedLink = "playground" | "github";

/** Where a gist import started: the import dialog or a link */
export type GistImportSource = "dialog" | "link";

/** Why a gist import stopped */
export type GistImportFailure =
  | "not-found"
  | "rate-limited"
  | "too-large"
  | "invalid"
  | "no-program"
  | "request-failed";

type GistEvents = {
  /**
   * The share dialog started an export: the user pressed create, or the
   * export resumed after a sign-in or a grant of gist access. `files` counts
   * the gist's files: the manifest and empty files (listed only in the
   * manifest) left out. `source` says where the dialog was opened.
   */
  gist_export_started: {
    files: number;
    visibility: GistVisibility;
    source: GistShareSource;
  };
  /** The dialog asked the user to allow gists on GitHub */
  gist_export_scope_requested: NoParams;
  /** GitHub made the gist; `files` as in `gist_export_started` */
  gist_export_succeeded: { files: number; visibility: GistVisibility };
  /**
   * A share ended without a gist; the dialog, or for `read-failed` the frame's
   * toast, said why. A sign-in or a grant the user cancelled counts as
   * `sign-in-failed`. A project that could not be read counts as `read-failed`,
   * with no `gist_export_started` before it.
   */
  gist_export_failed: {
    reason: GistExportFailure;
    visibility: GistVisibility;
  };
  /**
   * A copy in the shared state reached the clipboard: the Playground link or
   * the gist's GitHub URL. A refused clipboard sends nothing.
   */
  gist_link_copied: { copied: GistCopiedLink };
  /** An import from the dialog, or a gist link, started reading a gist. */
  gist_import_started: { from: GistImportSource };
  /**
   * The gist's files are read and laid out, before a project is created or a
   * view opened; `layout` says whether Playground's manifest placed them or
   * their kind did.
   */
  gist_import_succeeded: {
    from: GistImportSource;
    layout: "manifest" | "loose";
  };
  /**
   * The import stopped; the user saw the message for `reason`.
   * `request-failed` also counts a fault of ours, which is reported as well.
   */
  gist_import_failed: { from: GistImportSource; reason: GistImportFailure };
};

export const gistTelemetry = createTracker<GistEvents>();
