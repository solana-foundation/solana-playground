import { addImports, fetchJSDependencyMap } from "@/frameworks/common";
import type { TupleFiles } from "@/utils";
import { PgConnection, PgFramework } from "@/utils";

import type {
  ConvertedProfile,
  ConvertProfile,
  ExportProfile,
} from "./telemetry";
import { projectExportTelemetry } from "./telemetry";
import { toNodeProjectWith, toPublicEndpoint } from "./typescript-profile";

/** Whether a project converts with its framework or with the TypeScript profile */
export type ProjectKind = "program" | "no-program";

/**
 * The frameworks as the events name them; keyed by every `FrameworkName`, so
 * a new framework does not compile until it has a profile here and in
 * `ConvertedProfile`
 */
const FRAMEWORK_PROFILES: Record<FrameworkName, ConvertedProfile> = {
  Anchor: "anchor",
  Native: "native",
  Seahorse: "seahorse",
};

/**
 * What an export throws when the zip itself failed, after any conversion;
 * `profile` is how the zip was made, for the failure's event
 */
class DownloadError extends Error {
  constructor(readonly profile: ExportProfile, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "DownloadError";
  }
}

/**
 * Whether an export failed at the download, not at the conversion: nothing
 * downloaded, and an export as is would fail the same way. The failure names
 * the `profile` of the zip that did not download.
 */
export const isDownloadFailure = (error: unknown): error is DownloadError =>
  error instanceof DownloadError;

const kindOf = (files: TupleFiles): ProjectKind =>
  PgFramework.hasProgram(files.map(([path]) => path))
    ? "program"
    : "no-program";

/**
 * Read which conversion "Convert and export" would use for a project.
 *
 * @param name the project
 * @returns `program` when a Rust or Python file sits under `src/`
 */
export const readProjectKind = async (name: string) =>
  kindOf(await PgFramework.readWorkspaceFiles(name));

/**
 * The endpoint a TypeScript export falls back to, and the one its dialog names:
 * the public endpoint of the cluster Playground is on (`toPublicEndpoint`)
 */
export const exportedEndpoint = () =>
  toPublicEndpoint(PgConnection.cluster, PgConnection.current.rpcEndpoint);

/**
 * Zip and download, telling a failure here from a conversion's by the
 * `profile` of the zip
 */
const downloadWith =
  (profile: ExportProfile) => async (name: string, files: TupleFiles) => {
    try {
      await PgFramework.downloadZip(name, files);
    } catch (e) {
      throw new DownloadError(profile, e);
    }
  };

/**
 * Export a project's files as they are. The caller counts the outcome where
 * the export started (`features/project-files`).
 *
 * @param name the project
 * @returns the number of files in the zip
 * @throws when the project cannot be read, and when the zip did not download
 * (`isDownloadFailure`)
 */
export const exportAsIs = async (name: string) => {
  const files = await PgFramework.readWorkspaceFiles(name);
  await downloadWith("as-is")(name, files);
  return files.length;
};

/** A conversion's result, with the profile that made it */
type Converted = {
  profile: ConvertedProfile;
  files: TupleFiles;
  readme: string;
};

/** What a converted export resolves with: the README to show, and the zip */
export type ConvertedExport = {
  /** Markdown text to show once the zip is saved */
  readme: string;
  /** The conversion that made the zip */
  profile: ConvertedProfile;
  /** The number of files in the zip */
  files: number;
};

/**
 * Export a project converted to work locally: with its framework when it has a
 * program, with the TypeScript profile when it has none. A lost conversion is
 * counted here; the caller counts the zip where the export started
 * (`features/project-files`).
 *
 * @param name the project
 * @returns the README to show after, with the zip's profile and file count
 * @throws when the conversion fails (`PgFramework.isUnknownFramework` when no
 * framework recognises the program), and when the zip did not download
 * (`isDownloadFailure`)
 */
export const exportConverted = async (
  name: string
): Promise<ConvertedExport> => {
  // The conversion tried, for the failure event: `unknown` until the files
  // say, and when no framework recognises the program
  let attempted: ConvertProfile = "unknown";
  let converted: Converted;
  try {
    const files = await PgFramework.readWorkspaceFiles(name);
    if (kindOf(files) === "program") {
      const framework = await PgFramework.getFromFiles(files);
      if (framework) attempted = FRAMEWORK_PROFILES[framework.name];
      const result = await PgFramework.convertToFramework(files);
      converted = {
        profile: FRAMEWORK_PROFILES[result.framework],
        files: result.files,
        readme: result.readme,
      };
    } else {
      attempted = "typescript";
      const result = await toNodeProjectWith(fetchJSDependencyMap)(addImports)(
        exportedEndpoint()
      )(name)(files);
      converted = {
        profile: "typescript",
        files: result.files,
        readme: result.readme,
      };
    }
  } catch (e) {
    projectExportTelemetry.track("export_convert_failed", {
      profile: attempted,
      reason: PgFramework.isUnknownFramework(e) ? "unknown-framework" : "error",
    });
    throw e;
  }

  await downloadWith(converted.profile)(name, converted.files);
  return {
    readme: converted.readme,
    profile: converted.profile,
    files: converted.files.length,
  };
};
