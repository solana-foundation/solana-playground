import { createTracker } from "@/shared/lib/telemetry";
import type { CliCluster, CliTool } from "./commands";
import type { DownloadFailure } from "./program";

/** Where a binary download was pressed */
export type DownloadFrom = "build-stage" | "guide";

/** Which control opened the guide */
export type GuideFrom = "mainnet-warning" | "deploy-stage";

type CliDeployEvents = {
  /** A program binary was fetched and handed to the browser to save. */
  cli_binary_downloaded: { from: DownloadFrom };
  /** No binary was saved; `reason` is a `DownloadFailure`. */
  cli_binary_download_failed: { from: DownloadFrom; reason: DownloadFailure };
  /** The "Deploy from your machine" guide opened from `from`. */
  cli_guide_opened: { from: GuideFrom };
  /**
   * The copy button of a deploy command in the guide was pressed; counted on
   * the press, since `CopyButton` reports no success, so a refused clipboard
   * still counts.
   */
  cli_command_copied: { tool: CliTool; cluster: CliCluster };
};

export const cliDeployTelemetry = createTracker<CliDeployEvents>();
