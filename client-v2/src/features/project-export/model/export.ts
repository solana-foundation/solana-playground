import { addImports, getJSDependencyMap } from "@/frameworks/common";
import type { TupleFiles } from "@/utils";
import { PgConnection, PgFramework } from "@/utils";

import type { ConvertedProfile, ConvertProfile } from "./telemetry";
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

/** What an export throws when the zip itself failed, after any conversion */
class DownloadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "DownloadError";
  }
}

/**
 * Whether an export failed at the download, not at the conversion: nothing
 * downloaded, and an export as is would fail the same way
 */
export const isDownloadFailure = (error: unknown) =>
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

/** Zip and download, telling a failure here from a conversion's */
const download = async (name: string, files: TupleFiles) => {
  try {
    await PgFramework.downloadZip(name, files);
  } catch (e) {
    throw new DownloadError(e);
  }
};

/**
 * Export a project's files as they are.
 *
 * @param name the project
 * @throws when the project cannot be read, and when the zip did not download
 */
export const exportAsIs = async (name: string) => {
  try {
    const files = await PgFramework.readWorkspaceFiles(name);
    await download(name, files);
    projectExportTelemetry.track("export_downloaded", {
      profile: "as-is",
      files: files.length,
    });
  } catch (e) {
    projectExportTelemetry.track("export_failed", { profile: "as-is" });
    throw e;
  }
};

/** A conversion's result, with the profile that made it */
type Converted = {
  profile: ConvertedProfile;
  files: TupleFiles;
  readme: string;
};

/**
 * Export a project converted to work locally: with its framework when it has a
 * program, with the TypeScript profile when it has none.
 *
 * @param name the project
 * @returns the README to show after
 * @throws when the conversion fails (`PgFramework.isUnknownFramework` when no
 * framework recognises the program), and when the zip did not download
 * (`isDownloadFailure`)
 */
export const exportConverted = async (name: string) => {
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
      const result = await toNodeProjectWith(getJSDependencyMap)(addImports)(
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

  try {
    await download(name, converted.files);
  } catch (e) {
    projectExportTelemetry.track("export_failed", {
      profile: converted.profile,
    });
    throw e;
  }
  projectExportTelemetry.track("export_downloaded", {
    profile: converted.profile,
    files: converted.files.length,
  });
  return converted.readme;
};
