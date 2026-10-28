import { createTracker } from "@/shared/lib/telemetry";
import type { NoParams } from "@/shared/lib/telemetry";

/** Why a share did not end in a gist */
export type GistExportFailure =
  | "too-large"
  | "signed-out"
  | "sign-in-failed"
  | "needs-gist-scope"
  | "github-unauthorized"
  | "rate-limited"
  | "rejected"
  | "request-failed";

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
   * the exported files, the manifest left out.
   */
  gist_export_started: { files: number };
  /** The dialog asked the user to allow gists on GitHub */
  gist_export_scope_requested: NoParams;
  /** GitHub made the gist; `files` as in `gist_export_started` */
  gist_export_succeeded: { files: number };
  /**
   * A share ended without a gist; the dialog said why. A sign-in or a grant
   * the user cancelled counts as `sign-in-failed`.
   */
  gist_export_failed: { reason: GistExportFailure };
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
