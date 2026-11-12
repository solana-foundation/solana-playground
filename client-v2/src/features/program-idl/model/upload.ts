import {
  type Address,
  address,
  assertIsSingleTransactionPlan,
  createClientWithGetMinimumBalanceFromRpc,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  createTransactionPlanner,
  fetchEncodedAccount,
  getTransactionEncoder,
  type InstructionPlanInput,
  isSolanaError,
  parseInstructionPlanInput,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type SingleTransactionPlan,
  SOLANA_ERROR__ACCOUNTS__ACCOUNT_NOT_FOUND,
  type TransactionPlan,
} from "@solana/kit";
import { VersionedTransaction } from "@solana/web3.js";
import {
  Compression,
  Encoding,
  fetchMaybeMetadata,
  findCanonicalPda,
  Format,
  getProgramAuthority,
  getWriteMetadataInstructionPlan,
  packDirectData,
} from "@solana-program/program-metadata";

import { createLogger } from "@/shared/lib/logger";

const log = createLogger("program-idl:upload");

/** The seed of the canonical Program Metadata account that holds a program's IDL */
const IDL_SEED = "idl";

/** What an upload needs from the Playground: a connection to read and send through, and a signer */
export interface IdlUploadDeps {
  connection: {
    rpcEndpoint: string;
    sendRawTransaction(raw: Uint8Array): Promise<string>;
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

export interface IdlUploadResult {
  /** The canonical Program Metadata account that holds the IDL */
  metadata: Address;
  /** `replaced` when the account already held an IDL */
  action: "created" | "replaced";
}

/** Why an upload ended before any transaction was sent */
export type IdlUploadRefusalReason =
  | "not_found"
  | "invalid"
  | "not_deployed"
  | "authority"
  | "rejected";

/**
 * An upload that ended before any transaction was sent, by a check of its own
 * or by the wallet. `message` is the whole line to show the user.
 */
export class IdlUploadRefusedError extends Error {
  override name = "IdlUploadRefusedError";

  constructor(readonly reason: IdlUploadRefusalReason, message: string) {
    super(message);
  }
}

/** The cluster holds no program at the program id: no account, an account that is not executable, or closed program data */
class ProgramNotDeployedError extends IdlUploadRefusedError {
  override name = "ProgramNotDeployedError";

  constructor(program: string, cause: unknown) {
    super(
      "not_deployed",
      `Program ${program} is not deployed on the selected network.`
    );
    this.cause = cause;
  }
}

/** The wallet is not the program's upgrade authority; `authority` is `undefined` when the program has none */
export class NotProgramAuthorityError extends IdlUploadRefusedError {
  override name = "NotProgramAuthorityError";

  constructor(readonly authority: string | undefined) {
    super(
      "authority",
      authority
        ? `The program's upgrade authority is ${authority}. Connect that wallet to upload the IDL.`
        : "The program has no upgrade authority, so no wallet can upload its IDL."
    );
  }
}

/** The wallet's `signAllTransactions` threw, which a declined approval does */
class UploadNotApprovedError extends IdlUploadRefusedError {
  override name = "UploadNotApprovedError";

  constructor(cause: unknown) {
    super(
      "rejected",
      "The wallet did not approve the IDL upload, so nothing was sent."
    );
    this.cause = cause;
  }
}

/** The canonical Program Metadata account holding `program`'s IDL */
const idlMetadataAddress = async (program: Address) => {
  const [pda] = await findCanonicalPda({ program, seed: IDL_SEED });
  return pda;
};

/** The program's upgrade authority and program data account, read from the cluster */
const fetchProgramAuthority = async (
  rpc: Parameters<typeof getProgramAuthority>[0],
  program: Address
) => {
  const account = await fetchEncodedAccount(rpc, program);
  // Read here because `getProgramAuthority` fails on a wallet or data account with an error that carries no code
  if (account.exists && !account.executable) {
    throw new ProgramNotDeployedError(
      program,
      new Error(`The account at ${program} is not executable`)
    );
  }
  try {
    return await getProgramAuthority(rpc, program);
  } catch (error) {
    if (isSolanaError(error, SOLANA_ERROR__ACCOUNTS__ACCOUNT_NOT_FOUND)) {
      throw new ProgramNotDeployedError(program, error);
    }
    throw error;
  }
};

/**
 * Creates or replaces `idl.program`'s canonical IDL with `idl.json`, on one
 * wallet approval. Throws an {@link IdlUploadRefusedError} while nothing was
 * sent, then whatever sending or confirming a transaction throws.
 */
export const uploadIdl = async (
  { connection, wallet }: IdlUploadDeps,
  idl: { program: string; json: string }
): Promise<IdlUploadResult> => {
  const rpc = createSolanaRpc(connection.rpcEndpoint);
  const program = address(idl.program);
  const walletAddress = address(wallet.publicKey.toBase58());

  const { authority, programData } = await fetchProgramAuthority(rpc, program);
  if (authority !== walletAddress) {
    throw new NotProgramAuthorityError(authority);
  }

  const metadataAddress = await idlMetadataAddress(program);
  const metadata = await fetchMaybeMetadata(rpc, metadataAddress);

  // The plan needs the wallet's address only; the wallet signs afterwards, once
  const signer = createNoopSigner(walletAddress);
  const { value: lifetime } = await rpc.getLatestBlockhash().send();
  const planner = createTransactionPlanner({
    createTransactionMessage: () =>
      pipe(
        // Legacy: no lookup table is used, and a wallet that tests a transaction's `version` for truthiness leaves a v0 one unsigned
        createTransactionMessage({ version: "legacy" }),
        (m) => setTransactionMessageFeePayerSigner(signer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m)
      ),
  });
  const planTransactions = (input: InstructionPlanInput) =>
    planner(parseInstructionPlanInput(input));

  const instructionPlan = await getWriteMetadataInstructionPlan(
    {
      getMinimumBalance:
        createClientWithGetMinimumBalanceFromRpc(rpc).getMinimumBalance,
      planTransactions,
      // The client asks this to learn whether the IDL fits in one transaction
      planTransaction: async (input: InstructionPlanInput) => {
        const plan = await planTransactions(input);
        assertIsSingleTransactionPlan(plan);
        return plan.message;
      },
    },
    {
      ...packDirectData({
        content: idl.json,
        compression: Compression.Zlib,
        encoding: Encoding.Utf8,
      }),
      format: Format.Json,
      payer: signer,
      authority: signer,
      program,
      programData,
      seed: IDL_SEED,
      metadata,
      closeBuffer: true,
    }
  );
  const stages = toStages(await planner(instructionPlan));

  const encoder = getTransactionEncoder();
  // A plan that replaces a large IDL creates a buffer account, whose keypair signs here
  const toSign = await Promise.all(
    stages.flat().map(async ({ message }) =>
      VersionedTransaction.deserialize(
        // Kit types the bytes read-only, and `deserialize` only reads them
        encoder.encode(
          await partiallySignTransactionMessageWithSigners(message)
        ) as Uint8Array
      )
    )
  );
  log.info("Planned an IDL upload", {
    context: { transactions: toSign.length, stages: stages.length },
  });

  let signed: VersionedTransaction[];
  try {
    signed = await wallet.signAllTransactions(toSign);
  } catch (error) {
    // The line shown to the user leaves the wallet's own words out
    log.warn("The wallet did not sign the IDL upload", {
      context: { error: String(error) },
    });
    throw new UploadNotApprovedError(error);
  }

  let next = 0;
  for (const stage of stages) {
    const batch = signed.slice(next, next + stage.length);
    next += stage.length;
    await Promise.all(
      batch.map(async (tx) => {
        const signature = await connection.sendRawTransaction(tx.serialize());
        const { value } = await connection.confirmTransaction(
          {
            signature,
            blockhash: lifetime.blockhash,
            lastValidBlockHeight: Number(lifetime.lastValidBlockHeight),
          },
          "confirmed"
        );
        if (value.err) {
          throw new Error(
            `IDL upload transaction ${signature} failed: ${JSON.stringify(
              value.err
            )}`
          );
        }
      })
    );
  }

  return {
    metadata: metadataAddress,
    action: metadata.exists ? "replaced" : "created",
  };
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

  describe("features/program-idl/model/upload", () => {
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
