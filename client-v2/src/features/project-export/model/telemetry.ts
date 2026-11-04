import { createTracker } from "@/shared/lib/telemetry";

/** A conversion that made a zip: a framework's, or the TypeScript profile */
export type ConvertedProfile = "anchor" | "native" | "seahorse" | "typescript";

/** How a zip was made: converted, or the project's files as they are */
export type ExportProfile = ConvertedProfile | "as-is";

/** The conversion "Convert and export" tried; `unknown` when no framework knew the program */
export type ConvertProfile = ConvertedProfile | "unknown";

type ProjectExportEvents = {
  /** A zip download started; `files` counts the files in it */
  export_downloaded: { profile: ExportProfile; files: number };
  /**
   * "Convert and export" could not convert, and the dialog falls back to the
   * plain zip. `error` is any failure but an unknown framework, and is also
   * reported.
   */
  export_convert_failed: {
    profile: ConvertProfile;
    reason: "unknown-framework" | "error";
  };
  /**
   * The zip did not download, converted (`profile` the conversion) or as is;
   * the dialog said so
   */
  export_failed: { profile: ExportProfile };
};

export const projectExportTelemetry = createTracker<ProjectExportEvents>();
