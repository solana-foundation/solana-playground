/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Idl } from "@coral-xyz/anchor";
import { BorshAccountsCoder, BorshInstructionCoder } from "@coral-xyz/anchor";

import { sameIdlName } from "@/shared/lib/idl-name";
import { createLogger } from "@/shared/lib/logger";

import {
  PgCommand,
  PgConnection,
  PgProgramInfo,
  PgTerminal,
  PgTx,
  PgWallet,
  PgWeb3,
} from "../../../../utils";
import { createGeneratableInstruction } from "../../../../utils/program-interaction/instruction";
import type { RunInput } from "../ports";
import type { AccountData } from "./account-read";
import { scalarsOf } from "./account-read";
import type { ActRun } from "./act-runner";
import type { Sender } from "./capture";
import { captureSends } from "./capture";
import type { FundingChain } from "./fund";
import type { Landed, RunPort } from "./run-call";
import { runOrCall } from "./run-call";
import type { DecodedCall } from "./transactions";
import { accountsWritten, fillRememberedWith } from "./transactions";

const log = createLogger("tutorial-conversation:run");

/** The client file a tutorial's run act runs, in the workspace's `client/` */
const CLIENT_FILE = "client.ts";

/** Reads of a confirmed transaction before the RPC is taken to not have it */
const TX_READS = 5;
const TX_READ_MS = 800;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The calls a wire transaction makes to the program, as its IDL decodes
 * them: the instruction, each argument's value as a string, and the
 * accounts by their IDL names. Instructions to other programs are skipped;
 * one to this program the IDL cannot decode (an IDL older than the program)
 * is left out, logged and flagged `undecoded`, so the call goal it would have
 * passed fails and nothing claims it was not called.
 */
// TODO(HOO-2357 follow-up): move to a pure module with a Hello Anchor IDL
// fixture test, and say on the card when an instruction did not decode;
// both deferred from the sx review, the by-hand devnet run covers it now
const decodeCalls = (
  encoded: string,
  programId: string,
  idl: Idl | null
): { calls: DecodedCall[]; undecoded?: true } => {
  if (!idl) return { calls: [], undecoded: true };
  const tx = PgWeb3.VersionedTransaction.deserialize(
    Buffer.from(encoded, "base64")
  );
  const { message } = tx;
  const keys = message.staticAccountKeys;
  const coder = new BorshInstructionCoder(idl);
  const calls: DecodedCall[] = [];
  let undecoded: true | undefined;
  for (const ix of message.compiledInstructions) {
    if (keys[ix.programIdIndex]?.toBase58() !== programId) continue;
    const decoded = coder.decode(Buffer.from(ix.data));
    if (!decoded) {
      log.warn(
        "An instruction to the tutorial's program its IDL cannot decode"
      );
      undecoded = true;
      continue;
    }
    const metas = ix.accountKeyIndexes.map((i) => ({
      pubkey: keys[i],
      isSigner: message.isAccountSigner(i),
      isWritable: message.isAccountWritable(i),
    }));
    const formatted = coder.format(decoded, metas);
    calls.push({
      instruction: decoded.name,
      args: Object.fromEntries(
        (formatted?.args ?? []).map((a) => [a.name, a.data])
      ),
      accounts: (formatted?.accounts ?? []).map((a) => ({
        name: a.name ?? "account",
        address: a.pubkey.toBase58(),
      })),
      wrote: accountsWritten(
        idl.instructions.find((i) => sameIdlName(i.name, decoded.name))
          ?.accounts ?? [],
        metas.map((meta) => ({
          address: meta.pubkey.toBase58(),
          isWritable: meta.isWritable,
          // The first key pays, and a tutorial's wallet is what pays
          isPayer: meta.pubkey.equals(keys[0]),
        }))
      ),
    });
  }
  return undecoded ? { calls, undecoded } : { calls };
};

/** A confirmed transaction's record, read until the RPC has indexed it */
const landedOnDevnet = async (signature: string): Promise<Landed | null> => {
  await PgTx.confirm(signature);
  for (let i = 0; i < TX_READS; i++) {
    const tx = await PgConnection.current.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta) {
      return {
        log: tx.meta.logMessages ?? [],
        err: tx.meta.err,
        computeUnits: tx.meta.computeUnitsConsumed ?? null,
        fee: tx.meta.fee,
        signer:
          tx.transaction.message.getAccountKeys().get(0)?.toBase58() ?? null,
      };
    }
    if (i < TX_READS - 1) await wait(TX_READ_MS);
  }
  return null;
};

/** An account with the fields the deployed IDL decodes, if it decodes */
const fetchOnDevnet = async (
  address: string
): Promise<AccountData | undefined> => {
  // A node behind the landing answers null for an account just created
  let info = null;
  for (let i = 0; i < TX_READS && !info; i++) {
    if (i) await wait(TX_READ_MS);
    info = await PgConnection.current.getAccountInfo(
      new PgWeb3.PublicKey(address),
      "confirmed"
    );
  }
  if (!info) return undefined;
  const idl = PgProgramInfo.idl as Idl | null;
  let fields: Record<string, string> = {};
  try {
    if (idl) {
      fields = scalarsOf(new BorshAccountsCoder(idl).decodeAny(info.data));
    }
  } catch (e) {
    // A zero copy account smaller than its layout: its size is what is drawn
    log.warn("An account did not decode", {
      context: { address, error: String(e) },
    });
  }
  return { size: info.data.length, fields };
};

/** The call act's instruction, through the Test form's sender */
const sendCall = async (
  call: NonNullable<RunInput["call"]>,
  deployed: RunInput["idl"]
) => {
  // The program on chain answers to the IDL it was deployed with: a build
  // since then must not change what is sent
  const idl = deployed ?? PgProgramInfo.callableIdl();
  const idlIx = idl?.instructions.find((ix) =>
    sameIdlName(ix.name, call.instruction)
  );
  if (!idlIx) {
    throw new Error(
      `The deployed program has no \`${call.instruction}\`. Build and deploy it again.`
    );
  }
  // Loaded here, not at the top: its storage reads `sessionStorage` on
  // import, which throws where the browser refuses storage and would take
  // the whole app down with it, as the Test panel's lazy load never did
  const { PgProgramInteraction } = await import(
    "../../../../utils/program-interaction"
  );
  // Fresh, not the Test form's saved copy: that one follows the last build
  const ix = createGeneratableInstruction(idlIx);
  const values = {
    ...ix.values,
    accounts: fillRememberedWith(call.accounts ?? {})(ix.values.accounts),
    args: ix.values.args.map((arg) => ({
      ...arg,
      generator: { type: "Custom" as const, value: call.args[arg.name] ?? "" },
    })),
  };
  await PgProgramInteraction.test(
    { ...ix, values },
    PgProgramInteraction.getAnchorProgram({ idl: idl ?? undefined })
  );
};

/** The run and call port over the editor's runner and devnet */
export const realRunPort = (
  funding: FundingChain,
  capSol: number
): RunPort => ({
  refusal: () =>
    PgConnection.cluster === "devnet"
      ? null
      : "Tutorials run on devnet. Switch the network to devnet in Settings and try again.",
  wallet: () => PgWallet.current?.publicKey.toBase58() ?? null,
  programId: () => PgProgramInfo.pk?.toBase58() ?? null,
  funding,
  capSol,
  send: async (act, input) => {
    const { error, captured } = await captureSends(
      PgWeb3.Connection.prototype as unknown as Sender,
      async () => {
        if (act === "run") {
          await PgCommand.run.execute(CLIENT_FILE);
          return;
        }
        if (!input.call) throw new Error("The call act names no instruction");
        await sendCall(input.call, input.idl);
      }
    );
    return { captured, error };
  },
  landed: landedOnDevnet,
  fetchAccount: fetchOnDevnet,
  decode: (encoded, deployed) => {
    const programId = PgProgramInfo.pk?.toBase58();
    if (!programId) return { calls: [], undecoded: true };
    try {
      return decodeCalls(
        encoded,
        programId,
        (deployed ?? PgProgramInfo.idl) as Idl | null
      );
    } catch (e) {
      // The result still lands; only its `called` is short, which fails a
      // call goal rather than passing it on a guess
      log.error(e, { report: true, context: { stage: "Decoding a call" } });
      return { calls: [], undecoded: true };
    }
  },
  print: (line) => PgTerminal.println(line),
  report: (error, stage) =>
    log.error(error, { report: true, context: { stage } }),
  now: () => Date.now(),
});

/** The run act and the call act, on devnet */
export const runOnDevnet =
  (funding: FundingChain, capSol: number): ActRun =>
  async (act, input, onStage) => {
    if (act !== "run" && act !== "call") {
      throw new Error(`runOnDevnet runs a run or a call, not a ${act}`);
    }
    const result = await runOrCall(
      realRunPort(funding, capSol),
      act,
      input,
      onStage
    );
    // The reason and the message only: no key material
    if (!result.ok) {
      log.warn(`A tutorial ${act} failed`, {
        context: {
          message: result.message,
          reason: "reason" in result ? result.reason : undefined,
        },
      });
    }
    return result;
  };
