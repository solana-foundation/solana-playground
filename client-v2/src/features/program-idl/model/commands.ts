import {
  type Address,
  address,
  createSolanaRpc,
  fetchEncodedAccount,
  generateKeyPairSigner,
  unwrapOption,
} from "@solana/kit";
import {
  AccountDiscriminator,
  Compression,
  DataSource,
  decodeBuffer,
  Encoding,
  findCanonicalPda,
  findMetadataPda,
  Format,
  getCloseInstruction,
  getCreateBufferInstructionPlan,
  getSetAuthorityInstruction,
  getWriteMetadataInstructionPlan,
  packDirectData,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
  unpackAndFetchData,
} from "@solana-program/program-metadata";

import { createLogger } from "@/shared/lib/logger";

import {
  type AuthorityAct,
  IdlUploadRefusedError,
  NotProgramAuthorityError,
} from "./refusal";
import { type IdlSendDeps, sendPlanWith } from "./send";
import {
  getEventCluster,
  type IdlCommand,
  programIdlTelemetry,
  type UnsupportedIdlCommand,
} from "./telemetry";
import {
  closingLeftoverFor,
  fetchMetadataSlot,
  fetchProgramAuthority,
  IDL_SEED,
  type IdlRpc,
  type IdlSource,
  toMaybeMetadata,
  toUploadJson,
} from "./upload";

const log = createLogger("program-idl:commands");

/** The line `fetch` adds when the account's address holds the buffer of an upload that failed after its first transaction */
const UNFINISHED_UPLOAD =
  "An upload of its IDL is unfinished: run the same `anchor idl init` or `anchor idl upgrade` again to finish it, or `anchor idl close` to recover its rent.";

/** What only the upgrade authority may do to a program's canonical metadata account, for {@link NotProgramAuthorityError} */
const CLOSE: AuthorityAct = { verb: "close", object: "metadata account" };
const WRITE: AuthorityAct = { verb: "write", object: "metadata account" };

/** What `anchor idl fetch` takes from its caller */
interface IdlFetch {
  /** Base58 */
  programId: string;
  /** The wallet whose non-canonical account is read, in base58; `undefined` reads the canonical account */
  authority: string | undefined;
  /** Its `rpcEndpoint` also names the events' `cluster` */
  connection: Pick<IdlSendDeps["connection"], "rpcEndpoint">;
}

/** What `anchor idl close` takes from its caller */
interface IdlClose extends IdlSendDeps {
  /** Base58 */
  programId: string;
  /** Of the canonical account to close */
  seed: string;
}

/** What `anchor idl create-buffer` takes from its caller */
interface IdlBufferCreation extends IdlSendDeps, IdlSource {}

/** What `anchor idl set-buffer-authority` takes from its caller */
interface IdlBufferHandover extends IdlSendDeps {
  /** Base58 */
  buffer: string;
  /** Base58 */
  newAuthority: string;
}

/** What `anchor idl write-buffer` takes from its caller */
interface IdlBufferWrite extends IdlSendDeps {
  /** Base58 */
  programId: string;
  /** Base58 */
  buffer: string;
  /** Of the canonical account to write */
  seed: string;
  /** Whether the buffer is closed, and its rent returned to the wallet, once its data is written */
  closeBuffer: boolean;
}

/** Sends the events of `command` around `run`: the start before its checks, then how it ended */
export const trackCommandFor =
  (command: IdlCommand) =>
  <Input extends Pick<IdlFetch, "connection">, Result>(
    run: (input: Input) => Promise<Result>
  ) =>
  async (input: Input): Promise<Result> => {
    const cluster = getEventCluster(input.connection.rpcEndpoint);
    programIdlTelemetry.track("idl_command_started", { command, cluster });
    let result: Result;
    try {
      result = await run(input);
    } catch (error) {
      const refused = error instanceof IdlUploadRefusedError;
      programIdlTelemetry.track("idl_command_failed", {
        command,
        cluster,
        reason: refused ? error.reason : "rpc",
      });
      // A refusal is an answer the user reads as a line; any other failure is logged for whoever looks into it
      if (!refused) log.error(error, { context: { command, cluster } });
      throw error;
    }
    programIdlTelemetry.track("idl_command_succeeded", { command, cluster });
    return result;
  };

/** Sends the one event of a subcommand the terminal does not run, which measures the demand for it */
export const trackUnsupportedIdlCommand = (
  command: UnsupportedIdlCommand,
  rpcEndpoint: string
) =>
  programIdlTelemetry.track("idl_command_failed", {
    command,
    cluster: getEventCluster(rpcEndpoint),
    reason: "unsupported",
  });

/** The IDL account of a program, the canonical one or the one `authority` wrote, with the RPC that read it */
const fetchIdlSlot = async (
  rpcEndpoint: string,
  account: { program: string; authority: string | undefined }
) => {
  const rpc = createSolanaRpc(rpcEndpoint);
  const [at] = await findMetadataPda({
    program: address(account.program),
    // eslint-disable-next-line unicorn/no-null -- the Program Metadata client takes `null` for the canonical account
    authority: account.authority ? address(account.authority) : null,
    seed: IDL_SEED,
  });
  return { rpc, slot: await fetchMetadataSlot(rpc, at) };
};

/**
 * The content of the Program Metadata account that holds a program's IDL: the
 * canonical one, or the one `account.authority` wrote. `undefined` when the
 * cluster holds none, or holds the buffer of an unfinished upload.
 */
export const fetchProgramMetadataIdl = async (
  rpcEndpoint: string,
  account: { program: string; authority: string | undefined }
): Promise<string | undefined> => {
  const { rpc, slot } = await fetchIdlSlot(rpcEndpoint, account);
  if (slot.kind !== "metadata") return undefined;
  return unpackAndFetchData({ rpc, ...slot.account.data });
};

/** The Program Metadata buffer account at `buffer`; refuses an address that holds none */
const fetchBufferAccount = async (rpc: IdlRpc, buffer: Address) => {
  const account = await fetchEncodedAccount(rpc, buffer);
  if (
    !account.exists ||
    account.programAddress !== PROGRAM_METADATA_PROGRAM_ADDRESS ||
    account.data[0] !== AccountDiscriminator.Buffer
  ) {
    throw new IdlUploadRefusedError(
      "not_found",
      `No Program Metadata buffer exists at ${buffer} on the selected network.`
    );
  }
  return decodeBuffer(account);
};

/**
 * `anchor idl fetch`: the published IDL of a program, as the account holds it,
 * with the subcommand's events. Throws an {@link IdlUploadRefusedError} when the program has none.
 */
export const fetchPublishedIdl = trackCommandFor("fetch")(
  async ({ programId, authority, connection }: IdlFetch): Promise<string> => {
    const { rpc, slot } = await fetchIdlSlot(connection.rpcEndpoint, {
      program: programId,
      authority,
    });
    if (slot.kind === "metadata") {
      return unpackAndFetchData({ rpc, ...slot.account.data });
    }
    const none = authority
      ? `Program ${programId} has no IDL published by ${authority} on the selected network.`
      : `Program ${programId} has no published IDL on the selected network.`;
    throw new IdlUploadRefusedError(
      "not_found",
      slot.kind === "buffer" ? `${none}\n${UNFINISHED_UPLOAD}` : none
    );
  }
);

/**
 * `anchor idl close`: closes a program's canonical metadata account and sends
 * its rent to the wallet, with the subcommand's events. Throws an
 * {@link IdlUploadRefusedError} while nothing was sent.
 */
export const closeMetadataAccountWith = (priorityFee: bigint) =>
  trackCommandFor("close")(
    async ({ programId, seed, connection, wallet }: IdlClose) => {
      const rpc = createSolanaRpc(connection.rpcEndpoint);
      const program = address(programId);
      const { authority, programData } = await fetchProgramAuthority(
        rpc,
        program
      );
      // The upgrade authority alone, as in the command-line client Anchor 1.1.2 runs, which refuses the account's own authority before it sends
      if (authority !== address(wallet.publicKey.toBase58())) {
        throw new NotProgramAuthorityError(authority, CLOSE);
      }
      const [metadata] = await findCanonicalPda({ program, seed });
      const account = await fetchEncodedAccount(rpc, metadata);
      if (!account.exists) {
        throw new IdlUploadRefusedError(
          "not_found",
          `Program ${programId} has no metadata account for the seed "${seed}" on the selected network.`
        );
      }

      await sendPlanWith(priorityFee)(
        { connection, wallet },
        {
          name: "IDL close",
          toPlan: ({ signer }) =>
            getCloseInstruction({
              account: metadata,
              authority: signer,
              program,
              programData,
              destination: signer.address,
            }),
        }
      );
    }
  );

/**
 * `anchor idl create-buffer`: stores the IDL in a buffer account of its own,
 * whose authority is the wallet, with the subcommand's events. Returns the
 * buffer's address. Throws an {@link IdlUploadRefusedError} while nothing was sent.
 */
export const createIdlBufferWith = (priorityFee: bigint) =>
  trackCommandFor("create-buffer")(
    async ({ idl, filepath, text, connection, wallet }: IdlBufferCreation) => {
      // Packed as an upload packs it, so `anchor idl write-buffer` can name the same compression and encoding
      const { data } = packDirectData({
        content: toUploadJson({ idl, filepath, text }),
        compression: Compression.Zlib,
        encoding: Encoding.Utf8,
      });
      const buffer = await generateKeyPairSigner();

      await sendPlanWith(priorityFee)(
        { connection, wallet },
        {
          name: "IDL buffer creation",
          toPlan: ({ signer, client }) =>
            getCreateBufferInstructionPlan(client, {
              newBuffer: buffer,
              authority: signer,
              payer: signer,
              data,
            }),
        }
      );
      return { buffer: buffer.address };
    }
  );

/**
 * `anchor idl set-buffer-authority`: hands a buffer the wallet owns to
 * `newAuthority`, with the subcommand's events. Throws an
 * {@link IdlUploadRefusedError} while nothing was sent.
 */
export const setBufferAuthorityWith = (priorityFee: bigint) =>
  trackCommandFor("set-buffer-authority")(
    async ({ buffer, newAuthority, connection, wallet }: IdlBufferHandover) => {
      const account = await fetchBufferAccount(
        createSolanaRpc(connection.rpcEndpoint),
        address(buffer)
      );
      const authority = unwrapOption(account.data.authority) ?? undefined;
      if (authority !== address(wallet.publicKey.toBase58())) {
        throw new IdlUploadRefusedError(
          "authority",
          authority
            ? `The buffer's authority is ${authority}. Connect that wallet to set a new authority.`
            : "The buffer has no authority, so no wallet can set a new one."
        );
      }
      const next = address(newAuthority);

      await sendPlanWith(priorityFee)(
        { connection, wallet },
        {
          name: "IDL buffer authority change",
          toPlan: ({ signer }) =>
            getSetAuthorityInstruction({
              account: account.address,
              authority: signer,
              newAuthority: next,
            }),
        }
      );
    }
  );

/**
 * `anchor idl write-buffer`: creates or replaces a program's canonical
 * metadata account from a buffer's data, with the subcommand's events. Throws an
 * {@link IdlUploadRefusedError} while nothing was sent.
 */
export const writeMetadataFromBufferWith = (priorityFee: bigint) =>
  trackCommandFor("write-buffer")(
    async ({
      programId,
      buffer,
      seed,
      closeBuffer,
      connection,
      wallet,
    }: IdlBufferWrite) => {
      const rpc = createSolanaRpc(connection.rpcEndpoint);
      const program = address(programId);
      const { authority, programData } = await fetchProgramAuthority(
        rpc,
        program
      );
      if (authority !== address(wallet.publicKey.toBase58())) {
        throw new NotProgramAuthorityError(authority, WRITE);
      }
      const source = await fetchBufferAccount(rpc, address(buffer));
      const [metadataAddress] = await findCanonicalPda({ program, seed });
      const slot = await fetchMetadataSlot(rpc, metadataAddress);

      await sendPlanWith(priorityFee)(
        { connection, wallet },
        {
          name: "IDL buffer write",
          toPlan: async ({ signer, client }) =>
            closingLeftoverFor(slot, {
              authority: signer,
              program,
              programData,
            })(
              await getWriteMetadataInstructionPlan(client, {
                // What the command-line client stores when Anchor names a buffer and no file: its default compression and encoding, and no format
                compression: Compression.Zlib,
                encoding: Encoding.Utf8,
                format: Format.None,
                dataSource: DataSource.Direct,
                buffer: source,
                closeBuffer,
                payer: signer,
                authority: signer,
                program,
                programData,
                seed,
                metadata: toMaybeMetadata(slot),
              })
            ),
        }
      );
    }
  );
