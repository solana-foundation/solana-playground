import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

import type { CliCluster, CliTool } from "./commands";
import type { DownloadFailure } from "./program";

/** Where a binary download was pressed */
export type DownloadFrom = "build-stage" | "guide";

/** The guide's step a copied command belongs to: 3 deploys, 3.1 uploads the IDL */
export type CommandStep = "deploy" | "idl";

/** Which control opened the guide */
export type GuideFrom = "mainnet-blocked" | "deploy-stage";

type CliDeployEvents = {
  /** A program binary was fetched and handed to the browser to save. */
  cli_binary_downloaded: { via: DownloadFrom };
  /** No binary was saved; `reason` is a `DownloadFailure`. */
  cli_binary_download_failed: { via: DownloadFrom; reason: DownloadFailure };
  /** The guide's "Download IDL" handed the IDL to the browser to save. */
  cli_idl_downloaded: NoParams;
  /** The "Deploy from your machine" guide opened; `via` is the control that opened it. */
  cli_guide_opened: { via: GuideFrom };
  /**
   * The copy button of a command in the guide was pressed, `step` naming
   * step 3 or 3.1; counted on the press, since `CopyButton` reports no
   * success, so a refused clipboard still counts.
   */
  cli_command_copied: { tool: CliTool; cluster: CliCluster; step: CommandStep };
};

export const cliDeployTelemetry = createTracker<CliDeployEvents>();
