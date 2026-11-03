import { useEffect, useState } from "react";

import { useRenderOnChange } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgProgramInfo, PgServer } from "@/utils";
import { downloadFailure, programName } from "../model/program";
import type { DownloadFailure } from "../model/program";
import { cliDeployTelemetry } from "../model/telemetry";
import type { DownloadFrom } from "../model/telemetry";
import BaseDownloadProgram from "./BaseDownloadProgram";
import type { DownloadNote } from "./BaseDownloadProgram";

const log = createLogger("cli-deploy:download");

/**
 * How long the binary's object URL outlives the click. Safari starts reading
 * a blob download after the click returns, so a revoke on the next task can
 * cut it off; a few seconds is past any start.
 */
const REVOKE_AFTER_MS = 10_000;

/** Hands `bytes` to the browser to save as `name`, keeping no copy */
const save = (name: string, bytes: Uint8Array) => {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/octet-stream" })
  );
  const a = document.createElement("a");
  a.download = name;
  a.href = url;
  try {
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
};

/**
 * The program's file name: the project's IDL names it (built or loaded), else
 * the workspace (`programName`)
 */
export const useProgramName = () => {
  const idl = useRenderOnChange(PgProgramInfo.onDidChangeIdl) as {
    name?: string;
    metadata?: { name?: string };
  } | null;
  return programName({
    idlName: idl?.metadata?.name ?? idl?.name,
    workspace: PgExplorer.currentWorkspaceName,
  });
};

/** "Download .so", connected: fetches the last build's binary on press */
const DownloadProgram = ({ from }: { from: DownloadFrom }) => {
  const name = useProgramName();
  const [note, setNote] = useState<DownloadNote | null>(null);
  const fileName = `${name}.so`;

  // A new build answers the note; it must not linger beside the new binary
  useEffect(() => {
    const sub = PgProgramInfo.onDidChangeUuid(() => setNote(null));
    return () => sub.dispose();
  }, []);

  const failed = (reason: DownloadFailure) =>
    cliDeployTelemetry.track("cli_binary_download_failed", { from, reason });

  /**
   * Tells the user, in a note rather than a toast, that a build would fix it.
   * The event and an info log still record it; it is no fault to report.
   */
  const askForBuild = (reason: DownloadNote, uuid: string | null) => {
    failed(reason);
    log.info("No binary to download; a build is needed", {
      context: { reason, uuid },
    });
    setNote(reason);
  };

  const onDownload = async () => {
    setNote(null);
    const uuid = PgProgramInfo.uuid;
    if (!uuid) {
      askForBuild("no-build", null);
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
      save(fileName, bytes);
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
    />
  );
};

export default DownloadProgram;
