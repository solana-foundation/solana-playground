import { useEffect, useState } from "react";

import { NETWORKS } from "@/constants";
import { isSignInFailure, PgSession } from "@/features/auth";
import type { GuideFrom } from "@/features/cli-deploy";
import { CliDeployGuide } from "@/features/cli-deploy";
import { PgStageDeploy, useDeployRun, useStageDeploy } from "@/features/deploy";
import { ProgramKeypair } from "@/features/program-keypair";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { requestConsole } from "@/widgets/layout-shell";

import {
  useBalance,
  useBlockExplorer,
  useProgramInfo,
  useRenderOnChange,
  useWallet,
} from "../../../hooks";
import type { Cluster } from "../../../utils";
import {
  PgConnection,
  PgExplorer,
  PgGlobal,
  PgSettings,
  PgWallet,
} from "../../../utils";
import type { DeployRecord } from "../state/deploy-history";
import { PgDeployHistory } from "../state/deploy-history";
import type { FlowState } from "../state/stage";
import { PgFlow } from "../state/stage";
import type { DeployDetails, DeployPayer } from "./BaseDeploy";
import BaseDeploy from "./BaseDeploy";
import { deployViewFor } from "./deploy-view";
import IdlActions, { useIdlName } from "./IdlActions";
import { markIfToldByStage } from "./stage-failure";

const log = createLogger("flow:deploy");

/** This workspace's deployments, newest first */
const readHistory = () =>
  PgDeployHistory.list(PgExplorer.currentWorkspaceName ?? "");

/**
 * Sign in for the faucet, then run the deploy the funding card stopped. A
 * failed sign-in shows on the account row, which `PgSession` updates. The
 * popup can stay open long enough to move elsewhere: a deploy the user no
 * longer looks at would pay for another project or network, so it stops.
 */
const signInThenDeploy = async () => {
  const cluster = PgConnection.cluster;
  const workspace = PgExplorer.currentWorkspaceName;
  try {
    await PgSession.signInWith({ from: "deploy" });
  } catch (error) {
    if (isSignInFailure(error)) {
      log.info("sign-in from the deploy stage failed", {
        context: { error: String(error) },
      });
      return;
    }
    reportButtonFailure("sign in")(error);
    return;
  }
  if (
    PgConnection.cluster !== cluster ||
    PgExplorer.currentWorkspaceName !== workspace
  ) {
    log.info("the project or network changed during sign-in, deploy not run");
    return;
  }
  // Signing in from the card is the user's request for SOL
  await PgStageDeploy.startWithAirdrop((error) =>
    markIfToldByStage("deploy", error)
  );
};

/**
 * Switches the connection to the offered network of this cluster, as a pick
 * in Settings does
 */
const showNetwork = (cluster: string) => {
  const network = NETWORKS.find((n) => n.cluster === cluster);
  if (network) PgSettings.connection.endpoint = network.value;
};

/** The Deploy stage, connected: the flow, the history, the chain, commands */
const Deploy = ({ onChangeNetwork }: { onChangeNetwork: () => void }) => {
  const [flow, setFlow] = useState<FlowState>(PgFlow.state);
  // Read on mount, not only on change: the stage router remounts this stage
  // on every switch, and no event fires to fill it again.
  const [history, setHistory] = useState<DeployRecord[]>(readHistory);
  const [guide, setGuide] = useState<GuideFrom>();
  const stage = useStageDeploy();
  const explorer = useBlockExplorer();
  const programInfo = useProgramInfo();
  const idlName = useIdlName();
  const run = useDeployRun();
  const wallet = useWallet();
  const balance = useBalance();
  const deployState = useRenderOnChange(PgGlobal.onDidChangeDeployState);
  useRenderOnChange(PgConnection.onDidChangeCluster);

  useEffect(() => {
    const refresh = () => setHistory(readHistory());
    const a = PgFlow.onDidChange(setFlow);
    const b = PgDeployHistory.onDidChange(refresh);
    const c = PgExplorer.onDidSwitchWorkspace(refresh);
    return () => {
      a.dispose();
      b.dispose();
      c.dispose();
    };
  }, []);

  // Only what the chain answered for a deployed program. The authority and
  // the program-data size describe the upgrade path, so they show only while
  // the program can still be upgraded.
  const onChain = programInfo.onChain;
  const deployed = onChain?.deployed === true;
  const upgradable = deployed && onChain?.upgradable === true;
  const details: DeployDetails = {
    upgradable: deployed ? upgradable : undefined,
    authority: upgradable ? onChain?.authority?.toBase58() : undefined,
    programSize: upgradable ? onChain?.programDataLen : undefined,
  };

  const payer: DeployPayer | undefined = wallet
    ? {
        address: wallet.publicKey.toBase58(),
        balance: typeof balance === "number" ? balance : undefined,
        playground: wallet.isPg === true,
      }
    : undefined;

  const saveKeypair = () => {
    try {
      PgWallet.export();
    } catch (error) {
      reportButtonFailure("save the keypair")(error);
      return;
    }
    PgStageDeploy.answerBackup(true);
  };

  // A record's cluster is whatever the browser stored; an explorer that
  // cannot open it gets no link rather than one to mainnet
  const linkWith = (url: (c: Cluster) => string) => (cluster: string) =>
    explorer.opens(cluster as Cluster) ? url(cluster as Cluster) : undefined;

  // A failed build leaves the server's last binary in place, so Deploy stays
  // available when one exists; the stage then asks before using it
  const built =
    flow.build === "done" ||
    (flow.build === "failed" && Boolean(programInfo.uuid));
  const programId = programInfo.pk?.toBase58();

  // A deploy typed in the terminal sets `deployState` to "loading" while the
  // stage's phase stays where its last run left it; the view reads both, so
  // either run holds the button (a second press would pause it, a toggle
  // upstream's sidebar offers and Flow does not) and hides the last outcome
  const view = deployViewFor({
    cluster: PgConnection.cluster ?? undefined,
    workspace: PgExplorer.currentWorkspaceName ?? undefined,
    wallet: wallet?.publicKey.toBase58(),
  })({ stage, deployState, flowDeploy: flow.deploy });

  return (
    <>
      <BaseDeploy
        cluster={PgConnection.cluster}
        built={built}
        view={view}
        details={details}
        history={history}
        payer={payer}
        run={run}
        addressUrl={(id, cluster) =>
          linkWith((c) => explorer.getAddressUrl(id, c))(cluster)
        }
        txUrl={(signature, cluster) =>
          linkWith((c) => explorer.getTxUrl(signature, c))(cluster)
        }
        onDeploy={() =>
          void PgStageDeploy.start((error) =>
            markIfToldByStage("deploy", error)
          ).catch(reportButtonFailure("deploy"))
        }
        onAirdrop={() =>
          void PgStageDeploy.startWithAirdrop((error) =>
            markIfToldByStage("deploy", error)
          ).catch(reportButtonFailure("deploy"))
        }
        onSignIn={() =>
          void signInThenDeploy().catch(reportButtonFailure("deploy"))
        }
        onSaveKeypair={saveKeypair}
        onDismissBackup={() => PgStageDeploy.answerBackup(false)}
        onStaleBuildAnswer={(answer) => PgStageDeploy.answerStaleBuild(answer)}
        onInteract={() => PgFlow.setStage("interact")}
        onGoToBuild={() => PgFlow.setStage("build")}
        onShowLog={requestConsole}
        onChangeNetwork={onChangeNetwork}
        isNetworkOffered={(cluster) =>
          NETWORKS.some((n) => n.cluster === cluster)
        }
        onShowNetwork={showNetwork}
        idlUpload={<IdlActions mode="upload-button" />}
        idlName={idlName}
        // Keyed on the project: an open dialog or a note never carries over
        // to another project's keypair
        programKeypair={
          <ProgramKeypair key={PgExplorer.currentWorkspaceName ?? ""} />
        }
        onOpenCliGuide={setGuide}
      />
      <CliDeployGuide
        from={guide}
        onClose={() => setGuide(undefined)}
        cluster={PgConnection.cluster ?? undefined}
        built={built}
        programId={programId}
      />
    </>
  );
};

export default Deploy;
