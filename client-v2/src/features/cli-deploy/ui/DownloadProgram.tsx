import { useEffect, useState } from "react";

import { useRenderOnChange } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgProgramInfo, PgServer } from "@/utils";

import { saveFile } from "../lib/save-file";
import type { DownloadFailure } from "../model/program";
import { downloadFailure, programName } from "../model/program";
import type { DownloadFrom } from "../model/telemetry";
import { cliDeployTelemetry } from "../model/telemetry";
import type { DownloadNote } from "./BaseDownloadProgram";
import BaseDownloadProgram from "./BaseDownloadProgram";

const log = createLogger("cli-deploy:download");

/** The IDL Playground holds for the program, built or loaded; `null` without one */
export const useIdl = () =>
  useRenderOnChange(PgProgramInfo.onDidChangeIdl) as {
    name?: string;
    metadata?: { name?: string };
  } | null;

/**
 * The program's file name: the project's IDL names it (built or loaded), else
 * the workspace (`programName`)
 */
export const useProgramName = () => {
  const idl = useIdl();
  return programName({
    idlName: idl?.metadata?.name ?? idl?.name,
    workspace: PgExplorer.currentWorkspaceName,
  });
};

/** "Download .so", connected: fetches the last build's binary on press */
const DownloadProgram = ({
  from,
  look,
}: {
  from: DownloadFrom;
  look?: "outline" | "link";
}) => {
  const name = useProgramName();
  const [note, setNote] = useState<DownloadNote | undefined>();
  const fileName = `${name}.so`;

  // A new build answers the note; it must not linger beside the new binary
  useEffect(() => {
    const sub = PgProgramInfo.onDidChangeUuid(() => setNote(undefined));
    return () => sub.dispose();
  }, []);

  const failed = (reason: DownloadFailure) =>
    cliDeployTelemetry.track("cli_binary_download_failed", { from, reason });

  /**
   * Tells the user, in a note rather than a toast, that a build would fix it.
   * The event and an info log still record it; it is no fault to report.
   */
  const askForBuild = (reason: DownloadNote, uuid: string | undefined) => {
    failed(reason);
    log.info("No binary to download; a build is needed", {
      context: { reason, uuid },
    });
    setNote(reason);
  };

  const onDownload = async () => {
    setNote(undefined);
    const uuid = PgProgramInfo.uuid;
    if (!uuid) {
      askForBuild("no-build", undefined);
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = await PgServer.deploy(uuid);
    } catch (e) {
      const reason = downloadFailure(e);
      if (reason === "not-built") {
        askForBuild(reason, uuid);
        return;
      }
      failed(reason);
      throw e;
    }
    if (bytes.length === 0) {
      failed("server");
      throw new Error("The build server sent an empty program binary");
    }

    try {
      saveFile(
        fileName,
        new Blob([bytes], { type: "application/octet-stream" })
      );
    } catch (e) {
      failed("save");
      throw e;
    }
    cliDeployTelemetry.track("cli_binary_downloaded", { from });
  };

  return (
    <BaseDownloadProgram
      fileName={fileName}
      note={note}
      onDownload={onDownload}
      look={look}
    />
  );
};

export default DownloadProgram;
