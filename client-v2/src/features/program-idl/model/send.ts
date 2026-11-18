import {
  address,
  assertIsSingleTransactionPlan,
  blockhash,
  type ClientWithGetMinimumBalance,
  type ClientWithTransactionPlanning,
  createClientWithGetMinimumBalanceFromRpc,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  createTransactionPlanner,
  getTransactionEncoder,
  type InstructionPlanInput,
  type NoopSigner,
  parseInstructionPlanInput,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type SingleTransactionPlan,
  type TransactionPlan,
} from "@solana/kit";
import { VersionedTransaction } from "@solana/web3.js";

import { createLogger } from "@/shared/lib/logger";
import { isWalletRejection } from "@/shared/lib/wallet-rejection";

import { IdlCommandRefusedError } from "./refusal";

const log = createLogger("program-idl:send");

/**
 * Micro-lamports per compute unit of a run without `--priority-fee`: the `--priority-fees` default of the command-line client Anchor 1.1.2 runs.
 * @see https://github.com/solana-program/program-metadata/blob/js%40v0.5.1/clients/js/src/cli/options.ts
 */
export const DEFAULT_PRIORITY_FEE = 100_000n;

/** Stands for the blockhash while the plan is sized; a blockhash has one length, so the real one, set before signing, changes no size */
const PLANNING_LIFETIME = {
  blockhash: blockhash("11111111111111111111111111111111"),
  lastValidBlockHeight: 0n,
};

/** What a subcommand that sends needs from the Playground: a connection to read and send through, and a signer */
export interface IdlSendDeps {
  connection: {
    rpcEndpoint: string;
    sendRawTransaction(
      raw: Uint8Array,
      preflight: { preflightCommitment: "confirmed" }
    ): Promise<string>;
    confirmTransaction(
      strategy: {
        signature: string;
        blockhash: string;
        lastValidBlockHeight: number;
      },
      commitment: "confirmed"
    ): Promise<{ value: { err: unknown } }>;
  };
  wallet: {
    publicKey: { toBase58(): string };
    signAllTransactions(
      txs: VersionedTransaction[]
    ): Promise<VersionedTransaction[]>;
  };
}

/** What a subcommand builds its instructions on */
export interface IdlPlanning {
  /** Stands for the connected wallet as the payer and the authority of an instruction */
  signer: NoopSigner;
  /** Plans as {@link sendPlanWith} does, so a size the Program Metadata client tests is the size that is sent */
  client: ClientWithGetMinimumBalance & ClientWithTransactionPlanning;
}

/** What {@link sendPlanWith} sends */
export interface IdlSendJob {
  /** Names the send in a line, as "IDL upload" does in "The wallet did not approve the IDL upload" */
  name: string;
  toPlan(
    planning: IdlPlanning
  ): InstructionPlanInput | Promise<InstructionPlanInput>;
}

/** The user declined the wallet's approval */
class SendNotApprovedError extends IdlCommandRefusedError {
  override name = "SendNotApprovedError";

  constructor(job: string, cause: unknown) {
    super(
      "rejected",
      `The wallet did not approve the ${job}, so nothing was sent.`
    );
    this.cause = cause;
  }
}

/** A send failed after its first transaction went to the cluster; `message` is the failure's own */
export class IdlSendFailedError extends Error {
  override name = "IdlSendFailedError";

  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
}

/** The cluster passed the blockhash's last valid block height before every transaction was confirmed; `message` is the whole line */
export class IdlSendExpiredError extends IdlSendFailedError {
  override name = "IdlSendExpiredError";

  constructor(job: string, cause: unknown) {
    super(
      `The ${job} expired before every transaction was confirmed. Run the same command again.`,
      cause
    );
  }
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Plans `job`, asks the wallet once for every transaction, and sends them
 * stage by stage, each at `priorityFee` micro-lamports per compute unit. Throws an
 * {@link IdlCommandRefusedError} while nothing was sent, then an {@link IdlSendFailedError}.
 */
export const sendPlanWith =
  (priorityFee: bigint) =>
  async (
    { connection, wallet }: IdlSendDeps,
    job: IdlSendJob
  ): Promise<void> => {
    const rpc = createSolanaRpc(connection.rpcEndpoint);
    // The plan needs the wallet's address only; the wallet signs afterwards, once
    const signer = createNoopSigner(address(wallet.publicKey.toBase58()));
    const planner = createTransactionPlanner({
      createTransactionMessage: () =>
        pipe(
          // Legacy: no lookup table is used, and a wallet that tests a transaction's `version` for truthiness leaves a v0 one unsigned
          createTransactionMessage({ version: "legacy" }),
          (m) => setTransactionMessageFeePayerSigner(signer, m),
          (m) =>
            setTransactionMessageLifetimeUsingBlockhash(PLANNING_LIFETIME, m),
          // A price of zero adds no instruction, as `--priority-fees 0` adds none in the command-line client Anchor runs
          (m) =>
            setTransactionMessageComputeUnitPrice(
              priorityFee > 0n ? priorityFee : undefined,
              m
            )
        ),
    });
    const planTransactions = (input: InstructionPlanInput) =>
      planner(parseInstructionPlanInput(input));

    const instructions = await job.toPlan({
      signer,
      client: {
        getMinimumBalance:
          createClientWithGetMinimumBalanceFromRpc(rpc).getMinimumBalance,
        planTransactions,
        // The Program Metadata client asks this to learn whether an IDL fits in one transaction
        planTransaction: async (input: InstructionPlanInput) => {
          const plan = await planTransactions(input);
          assertIsSingleTransactionPlan(plan);
          return plan.message;
        },
      },
    });
    const stages = toStages(await planTransactions(instructions));

    // Read after planning, the last request before the wallet, so the transactions stay valid as long as they can
    const { value: lifetime } = await rpc.getLatestBlockhash().send();
    const encoder = getTransactionEncoder();
    // A plan that creates a buffer account holds the buffer's keypair, which signs here
    const toSign = await Promise.all(
      stages.flat().map(async ({ message }) =>
        VersionedTransaction.deserialize(
          // Kit types the bytes read-only, and `deserialize` only reads them
          encoder.encode(
            await partiallySignTransactionMessageWithSigners(
              setTransactionMessageLifetimeUsingBlockhash(lifetime, message)
            )
          ) as Uint8Array
        )
      )
    );
    log.info("Planned a send", {
      context: {
        job: job.name,
        transactions: toSign.length,
        stages: stages.length,
      },
    });

    let signed: VersionedTransaction[];
    try {
      signed = await wallet.signAllTransactions(toSign);
    } catch (error) {
      // Any other failure is no choice of the user's, and its caller logs it
      if (!isWalletRejection(error)) throw error;
      // The line shown to the user leaves the wallet's own words out
      log.warn("The wallet did not sign", {
        context: { job: job.name, error: String(error) },
      });
      throw new SendNotApprovedError(job.name, error);
    }
    // Stages are cut from `signed` by count, so a short answer would skip the last ones and still end as a success
    if (signed.length !== toSign.length) {
      throw new Error(
        `The wallet returned ${signed.length} of ${toSign.length} signed transactions, so nothing was sent.`
      );
    }

    let next = 0;
    try {
      for (const stage of stages) {
        const batch = signed.slice(next, next + stage.length);
        next += stage.length;
        await Promise.all(
          batch.map(async (tx) => {
            // Simulated at the commitment the stage before was confirmed at: at the connection's own, `finalized` would not see what that stage created
            const signature = await connection.sendRawTransaction(
              tx.serialize(),
              { preflightCommitment: "confirmed" }
            );
            const { value } = await connection.confirmTransaction(
              {
                signature,
                blockhash: lifetime.blockhash,
                lastValidBlockHeight: Number(lifetime.lastValidBlockHeight),
              },
              "confirmed"
            );
            if (value.err) {
              throw new IdlSendFailedError(
                `${job.name} transaction ${signature} failed: ${JSON.stringify(
                  value.err
                )}`,
                value.err
              );
            }
          })
        );
      }
    } catch (error) {
      // A transaction confirmed with an error failed on its own, and running the command again would fail the same way
      if (error instanceof IdlSendFailedError) throw error;
      // One approval covers the whole plan, so an expired one is signed again only by running the command again
      if (await isPastBlockHeightFor(rpc)(lifetime.lastValidBlockHeight)) {
        throw new IdlSendExpiredError(job.name, error);
      }
      throw new IdlSendFailedError(messageOf(error), error);
    }
  };

/** Whether the cluster's block height is past `lastValidBlockHeight`, which no failure names the same way across RPCs; `false` when it cannot be read */
const isPastBlockHeightFor =
  (rpc: ReturnType<typeof createSolanaRpc>) =>
  async (lastValidBlockHeight: bigint) => {
    try {
      const height = await rpc
        .getBlockHeight({ commitment: "confirmed" })
        .send();
      return height > lastValidBlockHeight;
    } catch (error) {
      // The send's failure is the one the user reads; this read only words it
      log.warn("Could not read the block height after a failed send", {
        context: { error: String(error) },
      });
      return false;
    }
  };

/**
 * Orders a transaction plan into stages: a stage's transactions may land in
 * any order, and a stage starts only after the one before it is confirmed.
 */
const toStages = (plan: TransactionPlan): SingleTransactionPlan[][] => {
  switch (plan.kind) {
    case "single":
      return [[plan]];
    case "sequential":
      return plan.plans.flatMap(toStages);
    case "parallel": {
      const children = plan.plans.map(toStages);
      return children.every((stages) => stages.length === 1)
        ? [children.flatMap(([stage]) => stage)]
        : children.flat();
    }
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/program-idl/model/send", () => {
    const A = "11111111111111111111111111111111";
    const B = "SysvarRent111111111111111111111111111111111";
    const C = "SysvarC1ock11111111111111111111111111111111";
    const D = "BPFLoaderUpgradeab1e11111111111111111111111";

    /** A one-transaction plan, told from the others by its fee payer */
    const single = (payer: string): SingleTransactionPlan => ({
      kind: "single",
      planType: "transactionPlan",
      message: setTransactionMessageFeePayerSigner(
        createNoopSigner(address(payer)),
        createTransactionMessage({ version: "legacy" })
      ),
    });

    const parallel = (plans: TransactionPlan[]): TransactionPlan => ({
      kind: "parallel",
      planType: "transactionPlan",
      plans,
    });

    const sequential = (plans: TransactionPlan[]): TransactionPlan => ({
      kind: "sequential",
      planType: "transactionPlan",
      divisible: true,
      plans,
    });

    it.each([
      {
        label:
          "a sequential plan that holds a parallel one, the parallel one as one stage",
        plan: sequential([
          single(A),
          parallel([single(B), single(C)]),
          single(D),
        ]),
        stages: [[A], [B, C], [D]],
      },
      {
        label:
          "a parallel plan that holds a sequential one, one transaction at a time",
        plan: parallel([sequential([single(A), single(B)]), single(C)]),
        stages: [[A], [B], [C]],
      },
    ])("toStages orders $label", ({ plan, stages }) => {
      expect(
        toStages(plan).map((stage) =>
          stage.map(({ message }) => message.feePayer.address)
        )
      ).toEqual(stages);
    });
  });
}
