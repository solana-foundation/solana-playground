import { useEffect, useId, useState } from "react";

import type { CliCluster, CliTool } from "../model/commands";
import { cliClusterOf } from "../model/commands";
import type { GuideFrom } from "../model/telemetry";
import { cliDeployTelemetry } from "../model/telemetry";
import BaseCliDeployGuide from "./BaseCliDeployGuide";
import DownloadIdl from "./DownloadIdl";
import DownloadProgram, { useIdl, useProgramName } from "./DownloadProgram";

export interface CliDeployGuideProps {
  /** The control that opened the guide; `null` while it is closed */
  from: GuideFrom | null;
  onClose: () => void;
  /** Playground's cluster, `null` until read */
  cluster: string | null;
  /** The last build succeeded, so there is a binary to download */
  built: boolean;
  /** The project's program id, `null` when it has none yet */
  programId: string | null;
}

/**
 * The cluster the guide opens on: Mainnet from the mainnet warning, else the
 * one Playground is on, else Devnet. Localnet, testnet and custom endpoints
 * open on Devnet: the guide is for the two clusters people deploy to.
 */
const openingCluster = (from: GuideFrom, cluster: string | null): CliCluster =>
  from === "mainnet-warning" ? "mainnet" : cliClusterOf(cluster) ?? "devnet";

/** The CLI deploy guide, connected: the program's name, the download, events */
const CliDeployGuide = (p: CliDeployGuideProps) => {
  const name = useProgramName();
  const hasIdl = Boolean(useIdl());
  const noIdlId = useId();
  // The tool is the user's habit and stays across openings; the cluster is
  // the situation's, so each opening picks it again
  const [tool, setTool] = useState<CliTool>("solana");
  const [cluster, setCluster] = useState<CliCluster>("devnet");
  // Mirrors the `from` prop, which is `null` while the guide is closed
  // eslint-disable-next-line unicorn/no-null -- the prop's closed value
  const [openedFrom, setOpenedFrom] = useState<GuideFrom | null>(null);

  const { from } = p;
  // Set while rendering, not in an effect, so the dialog's first frame
  // already shows the opening cluster. Only an opening sets it: a cluster
  // read while the guide is open must not undo the user's pick.
  if (from !== openedFrom) {
    setOpenedFrom(from);
    if (from) setCluster(openingCluster(from, p.cluster));
  }

  useEffect(() => {
    if (from) cliDeployTelemetry.track("cli_guide_opened", { from });
  }, [from]);

  return (
    <BaseCliDeployGuide
      open={from !== null}
      onOpenChange={(open) => {
        if (!open) p.onClose();
      }}
      tool={tool}
      cluster={cluster}
      onToolChange={setTool}
      onClusterChange={setCluster}
      name={name}
      programId={p.programId}
      built={p.built}
      download={<DownloadProgram from="guide" />}
      hasIdl={hasIdl}
      downloadIdl={<DownloadIdl describedBy={noIdlId} />}
      noIdlId={noIdlId}
      onCopy={(step) =>
        cliDeployTelemetry.track("cli_command_copied", { tool, cluster, step })
      }
    />
  );
};

export default CliDeployGuide;
