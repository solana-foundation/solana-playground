import { reportButtonFailure } from "@/shared/lib/report-button-failure";

import { saveFile } from "../lib/save-file";
import { cliDeployTelemetry } from "../model/telemetry";
import BaseDownloadIdl from "./BaseDownloadIdl";
import { useIdl, useProgramName } from "./DownloadProgram";

const handleFailure = reportButtonFailure("download the IDL");

/**
 * "Download IDL", connected: saves the IDL Playground holds as
 * `<program>.json`, the file step 3.1's commands upload
 */
const DownloadIdl = ({ describedBy }: { describedBy: string }) => {
  const idl = useIdl();
  const fileName = `${useProgramName()}.json`;

  const handleDownload = () => {
    if (!idl) return;
    try {
      saveFile(
        fileName,
        new Blob([JSON.stringify(idl, undefined, 2)], {
          type: "application/json",
        })
      );
    } catch (e) {
      handleFailure(e);
      return;
    }
    cliDeployTelemetry.track("cli_idl_downloaded", {});
  };

  return (
    <BaseDownloadIdl
      fileName={fileName}
      hasIdl={Boolean(idl)}
      onDownload={handleDownload}
      describedBy={describedBy}
    />
  );
};

export default DownloadIdl;
