import {
  type Account,
  type Address,
  address,
  createSolanaRpc,
  fetchEncodedAccount,
  type InstructionPlan,
  isSolanaError,
  type Lamports,
  type MaybeAccount,
  sequentialInstructionPlan,
  SOLANA_ERROR__ACCOUNTS__ACCOUNT_NOT_FOUND,
  type TransactionSigner,
} from "@solana/kit";
import {
  AccountDiscriminator,
  Compression,
  decodeMetadata,
  Encoding,
  findCanonicalPda,
  findNonCanonicalPda,
  Format,
  getCloseInstruction,
  getProgramAuthority,
  getWriteMetadataInstructionPlan,
  type Metadata,
  packDirectData,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
} from "@solana-program/program-metadata";

import { isIdlV1 } from "@/entities/idl";
import { createLogger } from "@/shared/lib/logger";

import {
  type AuthorityAct,
  IdlUploadRefusedError,
  NotProgramAuthorityError,
  ProgramNotDeployedError,
} from "./refusal";
import { type IdlSendDeps, sendPlanWith } from "./send";

const log = createLogger("program-idl:upload");

/** The seed of the Program Metadata accounts that hold a program's IDL */
export const IDL_SEED = "idl";

/** What only the upgrade authority may do to a program's canonical IDL, for {@link NotProgramAuthorityError} */
const UPLOAD: AuthorityAct = { verb: "upload", object: "IDL" };

/** The RPC the Program Metadata client reads accounts through */
export type IdlRpc = Parameters<typeof getProgramAuthority>[0];

export interface IdlUploadResult {
  /** The Program Metadata account that holds the IDL */
  metadata: Address;
  /** `replaced` when the account already held an IDL */
  action: "created" | "replaced";
}

/** The IDL a subcommand takes: the one the project holds, or the one in a file of the project */
export interface IdlSource {
  /** In either Anchor format; `undefined` when the project holds none, or holds no file at `filepath` */
  idl: object | undefined;
  /** The file the IDL was read from, which a refusal's line names; absent for the IDL the project holds */
  filepath?: string;
  /** The text of the file at `filepath`, which `idl` is parsed from; absent for the IDL the project holds */
  text?: string;
}

/** The JSON a subcommand sends, when the IDL is in the Anchor 0.30+ format: a file's text as it is, or the IDL the project holds, serialised */
export const toUploadJson = ({ idl, filepath, text }: IdlSource) => {
  if (!idl) {
    throw new IdlUploadRefusedError(
      "not_found",
      filepath
        ? `The project has no IDL file at ${filepath}.`
        : "The project has no IDL to upload."
    );
  }
  // Anchor uploads an IDL the Playground cannot map to the 0.29 shape, so the gate is the format alone
  if (!isIdlV1(idl)) {
    throw new IdlUploadRefusedError(
      "invalid",
      filepath
        ? `The IDL in ${filepath} is not in the Anchor 0.30+ format.`
        : "The project's IDL is not in the Anchor 0.30+ format."
    );
  }
  // The command-line client Anchor 1.1.2 runs writes a file's text unchanged, so a file is not serialised again
  return text ?? JSON.stringify(idl);
};

/** The canonical Program Metadata account holding `program`'s IDL */
const idlMetadataAddress = async (program: Address) => {
  const [pda] = await findCanonicalPda({ program, seed: IDL_SEED });
  return pda;
};

/** What a metadata account's address holds: the account, a buffer an upload left when it failed after its first transaction, or nothing */
export type MetadataSlot =
  | { kind: "metadata"; account: Account<Metadata> & { exists: true } }
  | { kind: "buffer"; address: Address; lamports: Lamports }
  | { kind: "empty"; address: Address };

/** Reads the account at `at` by its discriminator, which `fetchMaybeMetadata` of the Program Metadata client does not check */
export const fetchMetadataSlot = async (
  rpc: IdlRpc,
  at: Address
): Promise<MetadataSlot> => {
  const account = await fetchEncodedAccount(rpc, at);
  if (
    !account.exists ||
    account.programAddress !== PROGRAM_METADATA_PROGRAM_ADDRESS
  ) {
    return { kind: "empty", address: at };
  }
  switch (account.data[0]) {
    case AccountDiscriminator.Metadata:
      return {
        kind: "metadata",
        account: { ...decodeMetadata(account), exists: true },
      };
    case AccountDiscriminator.Buffer:
      return { kind: "buffer", address: at, lamports: account.lamports };
    default:
      return { kind: "empty", address: at };
  }
};

/** The account a write plan of the Program Metadata client takes: a buffer is no metadata account yet, so the plan creates one */
export const toMaybeMetadata = (slot: MetadataSlot): MaybeAccount<Metadata> =>
  slot.kind === "metadata"
    ? slot.account
    : { exists: false, address: slot.address };

/** Runs `write` after closing the buffer an unfinished upload left in `slot`, and as it is otherwise */
export const closingLeftoverFor =
  (
    slot: MetadataSlot,
    closer: {
      authority: TransactionSigner;
      program: Address;
      programData: Address | undefined;
    }
  ) =>
  (write: InstructionPlan): InstructionPlan => {
    if (slot.kind !== "buffer") return write;
    // Closed rather than written into: `initialize` takes a buffer's whole length as the IDL's, so a longer leftover would leave its tail in the IDL
    return sequentialInstructionPlan([
      getCloseInstruction({
        account: slot.address,
        authority: closer.authority,
        program: closer.program,
        programData: closer.programData,
        destination: closer.authority.address,
      }),
      write,
    ]);
  };

/**
 * An upload failed after its first transaction and left a buffer at the
 * metadata account's address, which holds `lamports`. `message` is the failure's.
 */
export class UnfinishedIdlUploadError extends Error {
  override name = "UnfinishedIdlUploadError";

  constructor(
    readonly buffer: { address: Address; lamports: Lamports },
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.cause = cause;
  }
}

/** The failure of a send to `metadata`, as an {@link UnfinishedIdlUploadError} when it left a buffer there */
const toUploadFailureFor =
  (rpc: IdlRpc, metadata: Address) => async (failure: unknown) => {
    let slot: MetadataSlot;
    try {
      slot = await fetchMetadataSlot(rpc, metadata);
    } catch (error) {
      // The send's failure is the one the user reads; the read after it is logged
      log.warn("Could not read the metadata account after a failed upload", {
        context: { error: String(error) },
      });
      return failure;
    }
    return slot.kind === "buffer"
      ? new UnfinishedIdlUploadError(slot, failure)
      : failure;
  };

/** The program's upgrade authority and program data account, read from the cluster */
export const fetchProgramAuthority = async (rpc: IdlRpc, program: Address) => {
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

/** Finds the account an upload writes, and the program data account that a canonical write names */
type FetchUploadAccount = (
  rpc: IdlRpc,
  writer: { program: Address; wallet: Address }
) => Promise<{ metadata: Address; programData: Address | undefined }>;

/** The account derived from the program and the seed, which only the upgrade authority may write */
const fetchCanonicalAccount: FetchUploadAccount = async (
  rpc,
  { program, wallet }
) => {
  const { authority, programData } = await fetchProgramAuthority(rpc, program);
  if (authority !== wallet) {
    throw new NotProgramAuthorityError(authority, UPLOAD);
  }
  return { metadata: await idlMetadataAddress(program), programData };
};

/** The account `--non-canonical` writes: the one derived from the program, the seed, and the wallet, for a wallet that is not the upgrade authority */
const fetchNonCanonicalAccount: FetchUploadAccount = async (
  rpc,
  { program, wallet }
) => {
  const { authority } = await fetchProgramAuthority(rpc, program);
  // Refused here because the command-line client Anchor 1.1.2 runs sends this case to the canonical address without the program data account, which the Program Metadata program rejects
  if (authority === wallet) {
    throw new IdlUploadRefusedError(
      "authority",
      "The connected wallet is the program's upgrade authority, so its IDL goes to the canonical account. Run the command without `--non-canonical`."
    );
  }
  const [metadata] = await findNonCanonicalPda({
    program,
    authority: wallet,
    seed: IDL_SEED,
  });
  return { metadata, programData: undefined };
};

const uploadIdlFor =
  (fetchAccount: FetchUploadAccount) =>
  (priorityFee: bigint) =>
  async (
    { connection, wallet }: IdlSendDeps,
    idl: { program: string; json: string }
  ): Promise<IdlUploadResult> => {
    const rpc = createSolanaRpc(connection.rpcEndpoint);
    const program = address(idl.program);
    const account = await fetchAccount(rpc, {
      program,
      wallet: address(wallet.publicKey.toBase58()),
    });
    const slot = await fetchMetadataSlot(rpc, account.metadata);

    try {
      await sendPlanWith(priorityFee)(
        { connection, wallet },
        {
          name: "IDL upload",
          toPlan: async ({ signer, client }) => {
            const write = await getWriteMetadataInstructionPlan(client, {
              ...packDirectData({
                content: idl.json,
                compression: Compression.Zlib,
                encoding: Encoding.Utf8,
              }),
              format: Format.Json,
              payer: signer,
              authority: signer,
              program,
              programData: account.programData,
              seed: IDL_SEED,
              metadata: toMaybeMetadata(slot),
              closeBuffer: true,
            });
            return closingLeftoverFor(slot, {
              authority: signer,
              program,
              programData: account.programData,
            })(write);
          },
        }
      );
    } catch (error) {
      if (error instanceof IdlUploadRefusedError) throw error;
      throw await toUploadFailureFor(rpc, account.metadata)(error);
    }

    return {
      metadata: account.metadata,
      action: slot.kind === "metadata" ? "replaced" : "created",
    };
  };

/**
 * Creates or replaces `idl.program`'s canonical IDL with `idl.json`, on one
 * wallet approval. Throws an {@link IdlUploadRefusedError} while nothing was
 * sent, then whatever sending or confirming a transaction throws.
 */
export const uploadIdlWith = uploadIdlFor(fetchCanonicalAccount);

/** As {@link uploadIdlWith}, to the wallet's own account of `idl.program`; refuses the upgrade authority, whose IDL goes to the canonical account */
export const uploadNonCanonicalIdlWith = uploadIdlFor(fetchNonCanonicalAccount);
