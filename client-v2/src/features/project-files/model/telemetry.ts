import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";
import type {
  ConversionReason,
  GithubImportReason,
} from "@/utils/import-error";

/**
 * Where an import started: the GitHub dialog (and its examples), dropped
 * files, or a temporary project's Import button
 */
export type ImportVia = "github" | "files" | "temporary";

/** Where an export started: the explorer's Export dialog or the settings page */
export type ExportVia = "dialog" | "settings";

/**
 * Why an import or a GitHub link view failed (spec `client-v2-project-files`,
 * "Import failures carry an enumerated reason"), as the typed errors carry
 * it: `not-found`, `rate-limited`, `too-large`, `no-source`, `network` or
 * `other` from a `GithubImportError`; `unsupported` or `no-source` from a
 * `ConversionError`
 */
export type ImportReason = GithubImportReason | ConversionReason;

type ProjectFilesEvents = {
  /** An import made a project; `via` is where it started */
  project_imported: { via: ImportVia };
  /** An import ended without a project; `reason` says why, never a message */
  project_import_failed: { via: ImportVia; reason: ImportReason };
  /** A GitHub link (`/github/<owner>/<repo>…`) opened its repository's files */
  project_viewed: NoParams;
  /** A GitHub link could not load its repository; `reason` says why */
  project_view_failed: { reason: ImportReason };
  /**
   * A zip was handed to the browser; `converted` is `true` only when a
   * conversion succeeded, `false` for the project as it is or a fallback to it
   */
  project_exported: { via: ExportVia; converted: boolean };
  /** No zip was saved; the dialog or the settings page said so */
  project_export_failed: { via: ExportVia };
};

export const projectFilesTelemetry = createTracker<ProjectFilesEvents>();
