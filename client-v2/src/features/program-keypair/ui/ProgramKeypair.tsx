import { useEffect, useState } from "react";

import { useRenderOnChange } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { PgCommon, PgGlobal, PgProgramInfo, PgWeb3 } from "@/utils";

import {
  KEYPAIR_FILE_NAME,
  keypairFileContent,
  parseKeypairFile,
} from "../model/keypair-file";
import type { KeypairExportFrom } from "../model/telemetry";
import { programKeypairTelemetry } from "../model/telemetry";
import type { KeypairNote } from "./BaseProgramKeypair";
import BaseProgramKeypair from "./BaseProgramKeypair";

const log = createLogger("program-keypair:ui");

/**
 * The custom id differs from the keypair's and is not on the cluster yet, so
 * a first deploy would refuse. A deployed program upgrades under any keypair.
 */
const isMismatch = () => {
  const { kp, customPk, onChain } = PgProgramInfo;
  if (!kp || !customPk || kp.publicKey.equals(customPk)) return false;
  return onChain?.deployed !== true;
};

/** A deploy is running: it reads the keypair and the id again at its end */
const deployRunning = () => PgGlobal.deployState !== "ready";

/** Reads a file as a keypair; a decoded key that is not one is refused too */
const keypairOf = (text: string) => {
  const read = parseKeypairFile(text);
  if (!read.ok) return read;
  try {
    return {
      ok: true as const,
      kp: PgWeb3.Keypair.fromSecretKey(read.secretKey),
    };
  } catch (error) {
    log.info("keypair file holds no valid key", {
      context: { error: String(error) },
    });
    return { ok: false as const, reason: "wrong_shape" as const };
  }
};

/**
 * The Deploy stage's program id controls, connected to `PgProgramInfo`,
 * which persists them to the workspace's `program-info.json`.
 */
const ProgramKeypair = () => {
  useRenderOnChange(PgProgramInfo.onDidChangeKp);
  useRenderOnChange(PgProgramInfo.onDidChangeCustomPk);
  const pk = useRenderOnChange(PgProgramInfo.onDidChangePk);
  useRenderOnChange(PgProgramInfo.onDidChangeOnChain);
  useRenderOnChange(PgGlobal.onDidChangeDeployState);
  const mismatch = isMismatch();
  const [open, setOpen] = useState(mismatch);
  const [confirming, setConfirming] = useState(false);
  // A valid imported keypair waiting on the dialog, since it replaces one
  const [pendingImport, setPendingImport] =
    useState<InstanceType<typeof PgWeb3.Keypair>>();
  const [note, setNote] = useState<KeypairNote>(undefined);

  // A mismatch would stop a first deploy, so it opens the fold when it
  // appears; the user may still close it
  useEffect(() => {
    if (mismatch) setOpen(true);
  }, [mismatch]);

  const generate = () => {
    if (deployRunning()) return;
    const replaced = !!PgProgramInfo.kp;
    // eslint-disable-next-line unicorn/no-null -- `null` clears the persisted custom id in program-info.json
    PgProgramInfo.update({ kp: PgWeb3.Keypair.generate(), customPk: null });
    programKeypairTelemetry.track("keypair_generated", { replaced });
    setNote(undefined);
    setConfirming(false);
  };

  const exportFrom = (from: KeypairExportFrom) => {
    const kp = PgProgramInfo.kp;
    if (!kp) return;
    try {
      PgCommon.export(KEYPAIR_FILE_NAME, keypairFileContent(kp.secretKey));
    } catch (error) {
      reportButtonFailure("save the program keypair")(error);
      return;
    }
    programKeypairTelemetry.track("keypair_exported", { via: from });
  };

  const importFile = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      reportButtonFailure("read the keypair file")(error);
      return;
    }
    // Checked after the read: a run may have started while it took
    if (deployRunning()) return;
    const read = keypairOf(text);
    if (!read.ok) {
      log.info("keypair import refused", { context: { reason: read.reason } });
      programKeypairTelemetry.track("keypair_import_refused", {
        reason: read.reason,
      });
      setNote("refused");
      return;
    }
    // Ask first, as Generate does: the keypair it replaces may be the only
    // copy, and the next push uploads the new one over the account's
    if (PgProgramInfo.kp || PgProgramInfo.customPk) {
      setPendingImport(read.kp);
      setConfirming(true);
      return;
    }
    applyImport(read.kp);
  };

  const applyImport = (kp: InstanceType<typeof PgWeb3.Keypair>) => {
    if (deployRunning()) return;
    // An imported keypair names the program: a custom id would hide it
    // eslint-disable-next-line unicorn/no-null -- `null` clears the persisted custom id in program-info.json
    PgProgramInfo.update({ kp, customPk: null });
    programKeypairTelemetry.track("keypair_imported", {});
    setNote(undefined);
    setPendingImport(undefined);
    setConfirming(false);
  };

  const changeId = (text: string) => {
    if (deployRunning()) return;
    let customPk: InstanceType<typeof PgWeb3.PublicKey>;
    try {
      customPk = new PgWeb3.PublicKey(text);
    } catch {
      setNote("invalid");
      return;
    }
    PgProgramInfo.update({ customPk });
    programKeypairTelemetry.track("keypair_custom_id_set", {});
    setNote("changed");
  };

  const removeCustomId = () => {
    if (deployRunning()) return;
    // eslint-disable-next-line unicorn/no-null -- `null` clears the persisted custom id in program-info.json
    PgProgramInfo.update({ customPk: null });
    programKeypairTelemetry.track("keypair_custom_id_removed", {});
    setNote("removed");
  };

  return (
    <BaseProgramKeypair
      programId={pk?.toBase58()}
      hasKeypair={!!PgProgramInfo.kp}
      customId={!!PgProgramInfo.customPk}
      mismatch={mismatch}
      note={note}
      open={open}
      onOpenChange={setOpen}
      confirming={confirming}
      replacing={pendingImport ? "import" : "new"}
      held={deployRunning()}
      // Ask before anything is lost: an old keypair, or a custom id that
      // Generate removes
      onNew={() => {
        setPendingImport(undefined);
        if (PgProgramInfo.kp || PgProgramInfo.customPk) setConfirming(true);
        else generate();
      }}
      onConfirmNew={() =>
        pendingImport ? applyImport(pendingImport) : generate()
      }
      onCancelNew={() => {
        setConfirming(false);
        setPendingImport(undefined);
      }}
      onSaveOld={() => exportFrom("dialog")}
      onImport={(file) => void importFile(file)}
      onExport={() => exportFrom("block")}
      onEdit={() => setNote((n) => (n === "refused" ? n : undefined))}
      onChangeId={changeId}
      onRemoveCustomId={removeCustomId}
    />
  );
};

export default ProgramKeypair;
