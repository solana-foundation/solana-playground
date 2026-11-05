import { useSyncExternalStore } from "react";

import { createLogger } from "@/shared/lib/logger";

import {
  PgCommand,
  PgCommon,
  PgConnection,
  PgProgramInfo,
  PgSettings,
  PgTerminal,
  PgTx,
} from "../../../utils";
import {
  GeneratableInstruction,
  PgProgramInteraction,
} from "../../../utils/program-interaction";
import { PgCallHistory } from "../state/call-history";
import type { CallOutcome } from "./call-outcome";
import { failingLineWith } from "./call-outcome";

const log = createLogger("flow:run-call");

/** Errors the old Test UI translated, kept so the wording stays the same */
const KNOWN_ERRORS: Record<string, string> = {
  "unable to infer src variant": "Enum variant not found",
  "program.methods[txVals.name] is not a function":
    "Test component is outdated",
};

/** How long to wait before asking a second time for logs an RPC had not indexed */
const LOGS_RETRY_MS = 1500;

/**
 * The program's logs for a sent transaction. An RPC may not have indexed a
 * just-confirmed transaction yet, so an empty answer is asked once more; a
 * failed read is logged and reads as no logs, which the result shows as such.
 */
const readLogsWith =
  (connection: typeof PgConnection.current) =>
  async (signature: string): Promise<string[]> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const tx = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (tx?.meta?.logMessages) return tx.meta.logMessages;
      } catch (e) {
        log.warn("Could not read a call's logs", { context: { error: e } });
        return [];
      }
      if (attempt === 0) await PgCommon.sleep(LOGS_RETRY_MS);
    }
    return [];
  };

/** A transaction error as text; JSON when it serialises, which a BigInt may not */
const describe = (err: unknown) => {
  try {
    return JSON.stringify(err);
  } catch (e) {
    log.info("A transaction error is not JSON, shown as text", {
      context: { error: String(e) },
    });
    return String(err);
  }
};

/** An absent value as a stored record writes it: `null` */
// eslint-disable-next-line unicorn/no-null -- `CallRecord` persists an absent signature or failing line as null
const toStored = <T>(value: T | undefined) => value ?? null;

const send = async (ix: GeneratableInstruction): Promise<CallOutcome> => {
  let signature: string | undefined;
  // The connection the call goes out on: a network switch while the wallet
  // asks must not confirm a landed call on another cluster as failed
  const connection = PgConnection.current;
  try {
    signature = await PgCommon.transition(PgProgramInteraction.test(ix));
    const confirmed = await PgTx.confirm(signature, { connection });
    const logs = await readLogsWith(connection)(signature);
    const ok = !confirmed?.err;
    return {
      instruction: ix.name,
      ok,
      signature,
      logs,
      failingLine: ok
        ? undefined
        : failingLineWith(`Transaction failed: ${describe(confirmed?.err)}`)(
            logs
          ),
    };
  } catch (e: any) {
    const raw: string = e?.message ?? String(e);
    const message = KNOWN_ERRORS[raw] ?? raw;
    // A preflight failure (`SendTransactionError`) carries the simulation's
    // logs; anything else is not the program's answer and is logged
    const logs: string[] = Array.isArray(e?.logs) ? e.logs : [];
    if (!logs.length)
      log.warn("A call failed before the program answered", {
        context: { instruction: ix.name, error: e },
      });
    return {
      instruction: ix.name,
      ok: false,
      signature,
      logs,
      // A signature with a thrown error: sent, but its confirmation is unknown
      failingLine: signature
        ? `Could not confirm the call: ${message}`
        : failingLineWith(message)(logs),
    };
  }
};

/** Calls under way: outside the form, which a chip or a stage switch remounts */
let inFlight = 0;
const inFlightListeners = new Set<() => void>();

const moveInFlight = (by: 1 | -1) => {
  inFlight += by;
  inFlightListeners.forEach((listener) => listener());
};

const subscribeInFlight = (listener: () => void) => {
  inFlightListeners.add(listener);
  return () => {
    inFlightListeners.delete(listener);
  };
};

/** Whether a call is under way, so a remounted form cannot send it again */
export const useCallInFlight = () =>
  useSyncExternalStore(subscribeInFlight, () => inFlight > 0);

/**
 * Calls one instruction of the program Interact targets and reports how it
 * went. Never rejects: a failure is an outcome the panel shows. The terminal
 * prints the same story, and every finished call joins the history.
 */
export const runCall = async (
  ix: GeneratableInstruction
): Promise<CallOutcome> => {
  // Read before sending: the call belongs to the program and network it went
  // to, even if the person switches either while it is in flight
  const programId = PgProgramInfo.getPkStr();
  const cluster = PgConnection.cluster;
  // The panel shows the result; the terminal's copy is a convenience
  const print = (line: string) => {
    PgTerminal.println(line).catch((e) =>
      log.warn("Could not print to the terminal", { context: { error: e } })
    );
  };
  print(PgTerminal.info(`Calling \`${ix.name}\`...`));

  moveInFlight(1);
  const outcome = await send(ix).finally(() => moveInFlight(-1));

  // Nothing after the send may turn a finished call into a rejection
  try {
    print(
      outcome.ok
        ? PgTerminal.success("Call succeeded.")
        : PgTerminal.error(`Call failed: ${outcome.failingLine}`)
    );
    if (programId && cluster) {
      PgCallHistory.add({
        programId,
        cluster,
        instruction: outcome.instruction,
        ok: outcome.ok,
        signature: toStored(outcome.signature),
        failingLine: toStored(outcome.failingLine),
      });
    }
    if (outcome.signature && PgSettings.testUi.showTxDetailsInTerminal) {
      PgCommand.solana.execute("confirm", outcome.signature, "-v").catch((e) =>
        log.warn("Could not print the call's details", {
          context: { error: e },
        })
      );
    }
  } catch (e) {
    log.error(e, { report: true, context: { what: "record a finished call" } });
  }
  return outcome;
};
