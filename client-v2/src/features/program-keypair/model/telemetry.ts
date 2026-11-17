import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

import type { KeypairFileRefusal } from "./keypair-file";

/** Where a keypair file was saved from: the block, or the New keypair dialog */
export type KeypairExportFrom = "block" | "dialog";

type ProgramKeypairEvents = {
  /** "New keypair" or the dialog's "Generate" made a keypair; `replaced` when one existed. */
  keypair_generated: { replaced: boolean };
  /** An imported file became the project's program keypair. */
  keypair_imported: NoParams;
  /** An imported file was not a keypair; nothing changed. */
  keypair_import_refused: { reason: KeypairFileRefusal };
  /** The keypair file was handed to the browser to save; `via` is where it was saved from. */
  keypair_exported: { via: KeypairExportFrom };
  /** "Change program id" set a custom program id. */
  keypair_custom_id_set: NoParams;
  /** "Remove custom id" removed the custom program id. */
  keypair_custom_id_removed: NoParams;
};

export const programKeypairTelemetry = createTracker<ProgramKeypairEvents>();
