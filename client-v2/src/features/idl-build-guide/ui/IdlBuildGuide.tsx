import { useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgFramework } from "@/utils";
import { PgWorkspace } from "@/utils/explorer/workspace";

import type { IdlBuildMethod } from "../model/steps";
import { STEPS } from "../model/steps";
import type { ExportFailureReason, GuideSurface } from "../model/telemetry";
import { idlBuildGuideTelemetry } from "../model/telemetry";
import type { Download } from "./BaseIdlBuildGuide";
import BaseIdlBuildGuide from "./BaseIdlBuildGuide";

const log = createLogger("idl-build-guide:ui");

const FAILURE_MESSAGES: Record<ExportFailureReason, string> = {
  "unknown-framework":
    "Could not tell this project's framework, so it was not exported.",
  "no-workspace": "Open a project to download it.",
  other: "Could not export the project.",
};

const failureReason = (error: unknown): ExportFailureReason => {
  if (PgFramework.isUnknownFramework(error)) return "unknown-framework";
  if (
    error instanceof Error &&
    error.message === PgWorkspace.errors.CURRENT_NOT_FOUND
  ) {
    return "no-workspace";
  }
  return "other";
};

export interface IdlBuildGuideProps {
  /** The Flow stage the guide is opened from */
  surface: GuideSurface;
}

/** The guide, connected: the workspace export, telemetry, and the logger. */
const IdlBuildGuide = ({ surface }: IdlBuildGuideProps) => {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<IdlBuildMethod>("docker");
  const [download, setDownload] = useState<Download>({ state: "idle" });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setMethod("docker");
    setDownload({ state: "idle" });
    idlBuildGuideTelemetry.track("idl_guide_opened", { surface });
  };

  const handleMethod = (next: IdlBuildMethod) => {
    setMethod(next);
    idlBuildGuideTelemetry.track("idl_guide_method_picked", { method: next });
  };

  const handleDownload = async () => {
    setDownload({ state: "idle" });
    try {
      await PgFramework.exportWorkspace({ convert: true });
    } catch (error) {
      const reason = failureReason(error);
      if (reason === "other") log.error(error, { report: true });
      else log.warn("Could not export the project", { context: { reason } });
      idlBuildGuideTelemetry.track("idl_guide_export_failed", { reason });
      setDownload({ state: "failed", message: FAILURE_MESSAGES[reason] });
      return;
    }
    idlBuildGuideTelemetry.track("idl_guide_project_downloaded", {});
  };

  return (
    <BaseIdlBuildGuide
      open={open}
      onOpenChange={handleOpenChange}
      method={method}
      onMethod={handleMethod}
      steps={STEPS[method]}
      download={download}
      onDownload={handleDownload}
      onCopied={(step) =>
        idlBuildGuideTelemetry.track("idl_guide_command_copied", {
          method,
          step,
        })
      }
    />
  );
};

export default IdlBuildGuide;
