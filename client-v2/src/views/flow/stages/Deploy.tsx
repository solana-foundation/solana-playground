import { useEffect, useState } from "react";

import { CliDeployGuide } from "@/features/cli-deploy";
import type { GuideFrom } from "@/features/cli-deploy";

import BaseDeploy from "./BaseDeploy";
import type { DeployDetails, DeployPayer, DeployStatus } from "./BaseDeploy";
import IdlActions from "./IdlActions";
import {
  useBalance,
  useBlockExplorer,
  useProgramInfo,
  useRenderOnChange,
  useWallet,
} from "../../../hooks";
import { PgConnection, PgExplorer, PgGlobal, PgWallet } from "../../../utils";
import type { Cluster } from "../../../utils";
import { isSignInFailure, PgSession } from "@/features/auth";
import { PgStageDeploy, useDeployRun, useStageDeploy } from "@/features/deploy";
import type { StageDeployState } from "@/features/deploy";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { markIfToldByStage } from "./stage-failure";
import { PgDeployHistory } from "../state/deploy-history";
import type { DeployRecord } from "../state/deploy-history";
import { PgFlow } from "../state/stage";
import type { FlowState } from "../state/stage";

const log = createLogger("flow:deploy");

/** This workspace's deployments, newest first */
const readHistory = () =>
  PgDeployHistory.list(PgExplorer.currentWorkspaceName ?? "");

/**
 * A second click on Deploy while one is already running pauses it
 * (`deployState` becomes "paused") rather than starting a new one, which
 * upstream's sidebar exposes as an explicit "Continue"/pause toggle. Flow
 * does not offer that control, so the stage holds the button while a deploy
 * is starting or "running" instead. A run the user cancelled is not a
 * failure.
 */
const deployStatus = (
  deployState: unknown,
  flow: FlowState,
  stage: StageDeployState
): DeployStatus => {
  if (deployState === "loading" || stage.phase === "running") return "running";
  const cancelled =
    stage.phase === "stopped" && stage.stop.kind === "cancelled";
  if (flow.deploy === "failed" && !cancelled) return "failed";
  return "idle";
};

/** The funding stop's detail, when it ran on the project and network open now */
const fundingHere = (stage: StageDeployState) => {
  if (stage.phase !== "stopped" || stage.stop.kind !== "funding") return null;
  const { stop } = stage;
  const here =
    stop.cluster === PgConnection.cluster &&
    stop.workspace === (PgExplorer.currentWorkspaceName ?? null);
  return here ? stop.detail : null;
};

/**
 * Sign in for the faucet, then run the deploy the funding card stopped. A
 * failed sign-in shows on the account row, which `PgSession` updates.
 */
const signInThenDeploy = async () => {
  try {
    await PgSession.signIn();
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
  await PgStageDeploy.start((error) => markIfToldByStage("deploy", error));
};

/** The Deploy stage, connected: the flow, the history, the chain, commands */
const Deploy = () => {
  const [flow, setFlow] = useState<FlowState>(PgFlow.state);
  // Read on mount, not only on change: the stage router remounts this stage
  // on every switch, and no event fires to fill it again.
  const [history, setHistory] = useState<DeployRecord[]>(readHistory);
  const [guide, setGuide] = useState<GuideFrom | null>(null);
  const stage = useStageDeploy();
  const explorer = useBlockExplorer();
  const programInfo = useProgramInfo();
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
    upgradable: deployed ? upgradable : null,
    authority: upgradable ? onChain?.authority?.toBase58() ?? null : null,
    programSize: upgradable ? onChain?.programDataLen ?? null : null,
  };

  const payer: DeployPayer | null = wallet
    ? {
        address: wallet.publicKey.toBase58(),
        balance: typeof balance === "number" ? balance : null,
        playground: wallet.isPg === true,
      }
    : null;

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
  const linkTo = (cluster: string, url: (c: Cluster) => string) =>
    explorer.opens(cluster as Cluster) ? url(cluster as Cluster) : null;

  const built = flow.build === "done";
  const programId = programInfo.pk?.toBase58() ?? null;

  return (
    <>
      <BaseDeploy
        cluster={PgConnection.cluster}
        built={built}
        deploy={deployStatus(deployState, flow, stage)}
        programId={programId}
        details={details}
        history={history}
        payer={payer}
        run={run}
        funding={fundingHere(stage)}
        backup={
          stage.phase === "done" &&
          stage.backupFor !== null &&
          stage.backupFor === wallet?.publicKey.toBase58()
        }
        staleBuild={stage.phase === "running" && stage.askingStaleBuild}
        addressUrl={(id, cluster) =>
          linkTo(cluster, (c) => explorer.getAddressUrl(id, c))
        }
        txUrl={(signature, cluster) =>
          linkTo(cluster, (c) => explorer.getTxUrl(signature, c))
        }
        onDeploy={() =>
          void PgStageDeploy.start((error) =>
            markIfToldByStage("deploy", error)
          )
        }
        onSignIn={() => void signInThenDeploy()}
        onSaveKeypair={saveKeypair}
        onDismissBackup={() => PgStageDeploy.answerBackup(false)}
        onStaleBuildAnswer={(answer) => PgStageDeploy.answerStaleBuild(answer)}
        onInteract={() => PgFlow.setStage("interact")}
        idlUpload={<IdlActions mode="upload" />}
        onOpenCliGuide={setGuide}
      />
      <CliDeployGuide
        from={guide}
        onClose={() => setGuide(null)}
        cluster={PgConnection.cluster}
        built={built}
        programId={programId}
      />
    </>
  );
};

export default Deploy;
