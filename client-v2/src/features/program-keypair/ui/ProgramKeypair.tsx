import { useEffect, useState } from "react";

import { useRenderOnChange } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { PgCommon, PgProgramInfo, PgWeb3 } from "@/utils";
import {
  KEYPAIR_FILE_NAME,
  keypairFileContent,
  parseKeypairFile,
} from "../model/keypair-file";
import { programKeypairTelemetry } from "../model/telemetry";
import type { KeypairExportFrom } from "../model/telemetry";
import BaseProgramKeypair from "./BaseProgramKeypair";
import type { KeypairNote } from "./BaseProgramKeypair";

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
  const mismatch = isMismatch();
  const [open, setOpen] = useState(mismatch);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<KeypairNote>(null);

  // A mismatch would stop a first deploy, so it opens the fold when it
  // appears; the user may still close it
  useEffect(() => {
    if (mismatch) setOpen(true);
  }, [mismatch]);

  const generate = () => {
    const replaced = !!PgProgramInfo.kp;
    PgProgramInfo.update({ kp: PgWeb3.Keypair.generate(), customPk: null });
    programKeypairTelemetry.track("keypair_generated", { replaced });
    setNote(null);
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
    programKeypairTelemetry.track("keypair_exported", { from });
  };

  const importFile = async (file: File) => {
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      reportButtonFailure("read the keypair file")(error);
      return;
    }
    const read = keypairOf(text);
    if (!read.ok) {
      log.info("keypair import refused", { context: { reason: read.reason } });
      programKeypairTelemetry.track("keypair_import_refused", {
        reason: read.reason,
      });
      setNote("refused");
      return;
    }
    // An imported keypair names the program: a custom id would hide it
    PgProgramInfo.update({ kp: read.kp, customPk: null });
    programKeypairTelemetry.track("keypair_imported", {});
    setNote(null);
  };

  const changeId = (text: string) => {
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
    PgProgramInfo.update({ customPk: null });
    programKeypairTelemetry.track("keypair_custom_id_removed", {});
    setNote("removed");
  };

  return (
    <BaseProgramKeypair
      programId={pk?.toBase58() ?? null}
      hasKeypair={!!PgProgramInfo.kp}
      customId={!!PgProgramInfo.customPk}
      mismatch={mismatch}
      note={note}
      open={open}
      onOpenChange={setOpen}
      confirming={confirming}
      // Ask before anything is lost: an old keypair, or a custom id that
      // Generate removes
      onNew={() =>
        PgProgramInfo.kp || PgProgramInfo.customPk
          ? setConfirming(true)
          : generate()
      }
      onConfirmNew={generate}
      onCancelNew={() => setConfirming(false)}
      onSaveOld={() => exportFrom("dialog")}
      onImport={(file) => void importFile(file)}
      onExport={() => exportFrom("block")}
      onEdit={() => setNote((n) => (n === "refused" ? n : null))}
      onChangeId={changeId}
      onRemoveCustomId={removeCustomId}
    />
  );
};

export default ProgramKeypair;
