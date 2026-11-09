import { useEffect, useRef, useState } from "react";

import type { IdlReading } from "@/entities/idl";
import { IdlBuildGuide } from "@/features/idl-build-guide";
import { createLogger } from "@/shared/lib/logger";

import { useAirdrop } from "../../../components/Wallet/hooks/useAirdrop";
import {
  clusterName,
  networkInSentence,
  UNKNOWN_NETWORK,
} from "../../../constants";
import {
  useBalance,
  useExplorer,
  useProgramInfo,
  useRenderOnChange,
  useWallet,
} from "../../../hooks";
import {
  PgConnection,
  PgExplorer,
  PgProgramInfo,
  PgWeb3,
} from "../../../utils";
import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";
import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
import type { DeployRecord } from "../state/deploy-history";
import { PgDeployHistory } from "../state/deploy-history";
import { PgFlow } from "../state/stage";
import BaseInteract from "./BaseInteract";
import IdlActions from "./IdlActions";
import { builtAfterDeploy, solNeeded } from "./interact-callouts";
import { interactFacts, interactSurface } from "./interact-surface";
import InteractBody from "./InteractBody";

const log = createLogger("flow:interact");

/** Point `PgProgramInfo`'s target at the given deployment. Selecting the
 * record that matches the project's own keypair clears the override so the
 * project's own key stays in charge; any other record wins by import.
 *
 * Deploy history is user-editable `localStorage`, so `programId` isn't
 * guaranteed to be a valid base58 public key -- skip silently (and leave
 * `customPk` untouched) rather than throwing out of a `useEffect`. */
const target = (record: DeployRecord) => {
  const ownPk = PgProgramInfo.kp?.publicKey.toBase58();
  if (record.programId === ownPk) {
    PgProgramInfo.update({ customPk: null });
    return;
  }

  try {
    const customPk = new PgWeb3.PublicKey(record.programId);
    PgProgramInfo.update({ customPk });
  } catch (e) {
    log.error(new Error("Invalid deploy record program id", { cause: e }), {
      context: { programId: record.programId },
    });
  }
};

const Interact = () => {
  const [history, setHistory] = useState<DeployRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // The project's target before this stage's first pick, so leaving hands it
  // back: looking at another deployment must not cost the user a custom id
  // they set in the Deploy stage, which a deploy goes to.
  const heldRef = useRef<
    | {
        workspaceId: string | undefined;
        customPk: typeof PgProgramInfo.customPk;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    const refresh = () => {
      const list = PgDeployHistory.list(PgExplorer.currentWorkspaceName ?? "");
      setHistory(list);
      // Only keep the dropdown's own selection in sync here -- picking a
      // deployment to test against is a state-changing action (it points
      // `PgProgramInfo` at a possibly different program id) and must stay
      // behind an explicit choice in `pick`, never happen just because the
      // list refreshed or the tab mounted.
      setSelected((s) => {
        if (s && list.some((r) => r.id === s)) return s;
        return list[0]?.id ?? null;
      });
    };
    const a = PgDeployHistory.onDidChange(refresh);
    const b = PgExplorer.onDidSwitchWorkspace(refresh);
    return () => {
      a.dispose();
      b.dispose();
      const held = heldRef.current;
      heldRef.current = undefined;
      // Another project is open by now: its target is not this one's to set
      if (held && held.workspaceId === PgExplorer.currentWorkspaceId) {
        PgProgramInfo.update({ customPk: held.customPk });
      }
    };
  }, []);

  const pick = (id: string) => {
    setSelected(id);
    const record = history.find((r) => r.id === id);
    if (record) {
      const workspaceId = PgExplorer.currentWorkspaceId;
      if (heldRef.current?.workspaceId !== workspaceId) {
        heldRef.current = { workspaceId, customPk: PgProgramInfo.customPk };
      }
      target(record);
    }
  };

  const programInfo = useProgramInfo();
  const callable = PgProgramInfo.callableIdl();
  const explorer = useExplorer();
  const surface = interactSurface(interactFacts(explorer, programInfo));
  useRenderOnChange(PgConnection.onDidChangeCluster);
  const cluster = PgConnection.cluster;
  const programId = PgProgramInfo.getPkStr();

  // The deployed program is older than the code: this session's last green
  // build of this project against its newest deploy on this network
  const build = useLastBuild();
  const buildAt =
    build && !build.failed && build.workspace === explorer.currentWorkspaceName
      ? build.at
      : undefined;
  const deployAt = history.find((r) => r.cluster === cluster)?.at;

  // The fee payer cannot pay one fee (Spec 12): only with a wallet to pay
  const wallet = useWallet();
  const balance = useBalance();
  const { airdrop, faucet } = useAirdrop();
  const short =
    wallet && typeof balance === "number" && solNeeded(balance) && cluster
      ? {
          balance: +balance.toFixed(4),
          cluster: networkInSentence(cluster) ?? UNKNOWN_NETWORK,
          airdrop: faucet === "available" ? airdrop : undefined,
        }
      : undefined;

  const selectedIndex = history.findIndex((r) => r.id === selected);
  const selectedRecord = selectedIndex >= 0 ? history[selectedIndex] : null;
  const meta = selectedRecord
    ? [
        selectedIndex === 0 ? "latest" : null,
        clusterName(selectedRecord.cluster),
        `${selectedRecord.programId.slice(0, 4)}...`,
      ]
        .filter(Boolean)
        .join(" \u00b7 ")
    : // The picker already says None yet, and the stage what is missing
      "";

  return (
    <BaseInteract
      meta={meta}
      deployments={history.map((r, i) => ({
        id: r.id,
        label: deploymentLabel(r, i),
      }))}
      selected={selected}
      onPick={pick}
      surface={surface}
      cluster={clusterName(cluster)}
      network={networkInSentence(cluster)}
      onGoTo={(stage) => PgFlow.setStage(stage)}
      idlLoad={<IdlActions mode="upload" />}
      idlGuide={<IdlBuildGuide surface="interact" />}
      idlRefusal={idlRefusal(PgProgramInfo.readIdl())}
      programId={programId ?? undefined}
      builtAfterDeploy={builtAfterDeploy(buildAt, deployAt)}
      solNeeded={short}
      form={
        callable && (
          <InteractBody
            idl={callable}
            programId={programId}
            cluster={cluster}
            solNeededOn={short?.cluster}
          />
        )
      }
    />
  );
};

/** The reason a 1.x IDL was refused, for the bad-IDL notice */
const idlRefusal = (reading: IdlReading | null) =>
  reading?.kind === "refused" && reading.version === "1"
    ? reading.reason
    : undefined;

/** The session's last build, kept current */
const useLastBuild = () => {
  const [build, setBuild] = useState<BuildOutput | null>(PgBuildOutput.latest);
  useEffect(() => PgBuildOutput.onDidChange(setBuild).dispose, []);
  return build;
};

/** A deployment as the picker lists it: newest first, marked "latest" */
const deploymentLabel = (r: DeployRecord, i: number) =>
  `${i === 0 ? "latest \u00b7 " : ""}${clusterName(
    r.cluster
  )} \u00b7 ${r.programId.slice(0, 6)}\u2026 \u00b7 ${new Date(
    r.at
  ).toLocaleTimeString()}`;

export default Interact;
