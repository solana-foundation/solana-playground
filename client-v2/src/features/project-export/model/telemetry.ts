import { createTracker } from "@/shared/lib/telemetry";

/** A conversion that made a zip: a framework's, or the TypeScript profile */
export type ConvertedProfile = "anchor" | "native" | "seahorse" | "typescript";

/**
 * How a zip was made: converted, or the project's files as they are. The
 * export's outcome events (`project_exported`, `project_export_failed`) are
 * `features/project-files`'s, which declares the same union by hand, since a
 * feature never imports another feature; the two change together
 */
export type ExportProfile = ConvertedProfile | "as-is";

/** The conversion "Convert and export" tried; `unknown` when no framework knew the program */
export type ConvertProfile = ConvertedProfile | "unknown";

/**
 * Whether a zip downloaded is counted where the export started, by the
 * dialog and the settings page through `features/project-files`
 * (`project_exported`, `project_export_failed`); this slice counts only
 * the conversion it tried and lost.
 */
type ProjectExportEvents = {
  /**
   * "Convert and export" could not convert, and the dialog falls back to the
   * plain zip. `error` is any failure but an unknown framework, and is also
   * reported.
   */
  export_convert_failed: {
    profile: ConvertProfile;
    reason: "unknown-framework" | "error";
  };
};

export const projectExportTelemetry = createTracker<ProjectExportEvents>();
