import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

import type { CommandStepId, IdlBuildMethod } from "./steps";

/** Where the guide was opened: the Flow stage that offered it */
export type GuideSurface = "build" | "deploy" | "interact";

/** Why the project export failed */
export type ExportFailureReason =
  | "unknown-framework"
  | "no-workspace"
  | "other";

type IdlBuildGuideEvents = {
  /** The guide's dialog opened, from the stage named by `surface`. */
  idl_guide_opened: { surface: GuideSurface };
  /** The user switched the method; the method the dialog opens on is not counted. */
  idl_guide_method_picked: { method: IdlBuildMethod };
  /** A step's command reached the clipboard; a refused copy is not counted. */
  idl_guide_command_copied: { method: IdlBuildMethod; step: CommandStepId };
  /** "Download project" exported the workspace and the browser saved the zip. */
  idl_guide_project_downloaded: NoParams;
  /** "Download project" threw; the reason shows under the button and was logged. */
  idl_guide_export_failed: { reason: ExportFailureReason };
  /** A file dropped or picked on the last step was an IDL and is now the one in use. */
  idl_guide_idl_loaded: NoParams;
  /** A file dropped or picked on the last step was not an Anchor IDL; the step says so. */
  idl_guide_idl_refused: NoParams;
};

export const idlBuildGuideTelemetry = createTracker<IdlBuildGuideEvents>();
