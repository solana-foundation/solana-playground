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
 * How a zip was made: a framework's conversion, the TypeScript profile, or
 * the project's files as they are. The same union as `ExportProfile` in
 * `features/project-export`, which declares the conversions and which this
 * slice may not import (a feature never imports another feature); the two
 * change together, and a profile added there without one here fails to
 * compile where the dialog hands the export's result to this slice
 */
export type ExportProfile =
  | "anchor"
  | "native"
  | "seahorse"
  | "typescript"
  | "as-is";

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
   * conversion succeeded, `false` for the project as it is or a fallback to
   * it; `profile` is how the zip was made and `files` counts the files in it
   */
  project_exported: {
    via: ExportVia;
    converted: boolean;
    profile: ExportProfile;
    files: number;
  };
  /**
   * No zip was saved; the dialog or the settings page said so. `profile` is
   * how the zip was being made
   */
  project_export_failed: { via: ExportVia; profile: ExportProfile };
};

export const projectFilesTelemetry = createTracker<ProjectFilesEvents>();
