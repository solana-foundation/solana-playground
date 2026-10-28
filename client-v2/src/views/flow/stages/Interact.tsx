import { useEffect, useRef, useState } from "react";

import BaseInteract from "./BaseInteract";
import IdlActions from "./IdlActions";
import { interactFacts, interactSurface } from "./interact-surface";
import Test from "../../sidebar/test/Component/Test";
import {
  PgConnection,
  PgExplorer,
  PgProgramInfo,
  PgWeb3,
} from "../../../utils";
import { useExplorer, useProgramInfo } from "../../../hooks";
import { PgFlow } from "../state/stage";
import { PgDeployHistory } from "../state/deploy-history";
import type { DeployRecord } from "../state/deploy-history";

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
    console.error("Invalid deploy record program id", record.programId, e);
  }
};

const Interact = () => {
  const [history, setHistory] = useState<DeployRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Whether this component (not the project's own key) is the reason
  // `PgProgramInfo.customPk` is set, so unmounting can hand control back.
  const targetedRef = useRef(false);

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
      if (targetedRef.current) {
        PgProgramInfo.update({ customPk: null });
        targetedRef.current = false;
      }
    };
  }, []);

  const pick = (id: string) => {
    setSelected(id);
    const record = history.find((r) => r.id === id);
    if (record) {
      target(record);
      targetedRef.current = true;
    }
  };

  const programInfo = useProgramInfo();
  const explorer = useExplorer();
  const surface = interactSurface(interactFacts(explorer, programInfo));

  const selectedIndex = history.findIndex((r) => r.id === selected);
  const selectedRecord = selectedIndex >= 0 ? history[selectedIndex] : null;
  const meta = selectedRecord
    ? [
        selectedIndex === 0 ? "latest" : null,
        selectedRecord.cluster,
        `${selectedRecord.programId.slice(0, 4)}...`,
      ]
        .filter(Boolean)
        .join(" \u00b7 ")
    : "no deployments yet";

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
      cluster={PgConnection.cluster}
      onGoTo={(stage) => PgFlow.setStage(stage)}
      idlLoad={<IdlActions mode="upload" />}
      form={programInfo.idl && <Test idl={programInfo.idl} />}
    />
  );
};

/** A deployment as the picker lists it: newest first, marked "latest" */
const deploymentLabel = (r: DeployRecord, i: number) =>
  `${i === 0 ? "latest \u00b7 " : ""}${r.cluster} \u00b7 ${r.programId.slice(
    0,
    6
  )}\u2026 \u00b7 ${new Date(r.at).toLocaleTimeString()}`;

export default Interact;
