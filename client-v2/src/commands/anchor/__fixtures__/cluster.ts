// Test-only: a JSON-RPC endpoint over LiteSVM, which runs the Program Metadata program; vitest and Playwright both import it, so no `import.meta` and no `vitest`
import {
  type Address,
  address,
  getAddressEncoder,
  getBase64Decoder,
  getOptionEncoder,
  getSignatureFromTransaction,
  getStructEncoder,
  getTransactionDecoder,
  getU32Encoder,
  getU64Encoder,
  lamports,
  none,
  type ReadonlyUint8Array,
  signature as toSignature,
  some,
} from "@solana/kit";
import {
  getProgramDataPda,
  LOADER_V3_PROGRAM_ADDRESS,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
} from "@solana-program/program-metadata";
import { readFileSync } from "fs";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import { join } from "path";

/** Written by `regenerate.sh` beside it; `__dirname`, which Playwright's CommonJS and vitest both define */
const PROGRAM_METADATA_SO = join(__dirname, "program-metadata.so");

/** The JSON-RPC wire's empty value, where an RPC answers `null` */
// eslint-disable-next-line unicorn/no-null -- the JSON-RPC wire format
const WIRE_NULL = null;

/** Answered as a JSON-RPC error object, which web3.js and Kit throw from */
class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/** A cluster that runs the Program Metadata program, and answers the JSON-RPC methods the `anchor` subcommands call */
export const clusterOf = () => {
  const svm = new LiteSVM();
  svm.addProgram(
    PROGRAM_METADATA_PROGRAM_ADDRESS,
    readFileSync(PROGRAM_METADATA_SO)
  );

  /** The wire bytes of every `sendTransaction` request, accepted or not */
  const sent: Uint8Array[] = [];
  /** `sendTransaction` answers an RPC error to the request at this index, 0-based, without running it */
  let dropSendAt: number | undefined;
  /** At the request of this index, 0-based, the block height passes every lifetime issued so far and LiteSVM drops their blockhash */
  let expireAt: number | undefined;
  let blockHeight = 1;
  /** Blocks a blockhash stays valid for, as `getLatestBlockhash` answers on a real cluster */
  const LIFETIME_BLOCKS = 150;

  /** Sets an account as LiteSVM holds it, rent-exempt for its size */
  const setAccount = (
    at: Address,
    {
      owner,
      executable,
      data,
    }: { owner: Address; executable: boolean; data: ReadonlyUint8Array }
  ) =>
    svm.setAccount({
      address: at,
      data,
      executable,
      lamports: lamports(
        svm.minimumBalanceForRentExemption(BigInt(data.length))
      ),
      programAddress: owner,
      space: BigInt(data.length),
    });

  /** Deploys `program` with loader v3, its upgrade authority `authority`, or none; the program data holds no code, which no test runs */
  const deploy = async (program: Address, authority: string | undefined) => {
    const [programData] = await getProgramDataPda(program);
    setAccount(program, {
      owner: LOADER_V3_PROGRAM_ADDRESS,
      executable: true,
      data: getStructEncoder([
        ["discriminator", getU32Encoder()],
        ["programData", getAddressEncoder()],
      ]).encode({ discriminator: 2, programData }),
    });
    setAccount(programData, {
      owner: LOADER_V3_PROGRAM_ADDRESS,
      executable: false,
      data: getStructEncoder([
        ["discriminator", getU32Encoder()],
        ["slot", getU64Encoder()],
        ["authority", getOptionEncoder(getAddressEncoder())],
      ]).encode({
        discriminator: 3,
        slot: 0n,
        authority: authority ? some(address(authority)) : none(),
      }),
    });
  };

  const encodeAccount = (at: string) => {
    const account = svm.getAccount(address(at));
    if (!account.exists) return WIRE_NULL;
    return {
      data: [getBase64Decoder().decode(account.data), "base64"],
      executable: account.executable,
      lamports: Number(account.lamports),
      owner: account.programAddress,
      rentEpoch: 0,
      space: account.data.length,
    };
  };

  const context = { slot: 1 };

  const sendTransaction = (base64: string) => {
    const raw: Uint8Array = Buffer.from(base64, "base64");
    const index = sent.push(raw) - 1;
    if (index === dropSendAt) {
      throw new RpcError(-32005, "Node is behind");
    }
    if (index === expireAt) {
      svm.expireBlockhash();
      blockHeight += LIFETIME_BLOCKS + 1;
    }
    const tx = getTransactionDecoder().decode(raw);
    const result = svm.sendTransaction(tx);
    if (result instanceof FailedTransactionMetadata) {
      throw new RpcError(
        -32002,
        `Transaction simulation failed: ${result.toString()}`
      );
    }
    return getSignatureFromTransaction(tx);
  };

  const answer = (method: string, params: unknown[]): unknown => {
    switch (method) {
      case "getAccountInfo":
        return { context, value: encodeAccount(String(params[0])) };
      case "getLatestBlockhash":
        return {
          context,
          value: {
            blockhash: svm.latestBlockhash(),
            lastValidBlockHeight: blockHeight + LIFETIME_BLOCKS,
          },
        };
      // web3.js polls it while it waits for a confirmation; it passes a lifetime only through `expireAt`
      case "getBlockHeight":
        return blockHeight;
      case "getMinimumBalanceForRentExemption":
        return Number(
          svm.minimumBalanceForRentExemption(BigInt(Number(params[0])))
        );
      case "sendTransaction":
        return sendTransaction(String(params[0]));
      case "getSignatureStatuses":
        return {
          context,
          value: (params[0] as string[]).map((signature) =>
            svm.getTransaction(toSignature(signature))
              ? {
                  slot: 1,
                  confirmations: WIRE_NULL,
                  err: WIRE_NULL,
                  confirmationStatus: "confirmed",
                }
              : WIRE_NULL
          ),
        };
      default:
        throw new Error(`The test cluster has no answer for ${method}`);
    }
  };

  /** The response body to one JSON-RPC request body, from the LiteSVM state at that moment; throws for a method it has no answer for */
  const respond = (body: string) => {
    const { id, method, params } = JSON.parse(body);
    try {
      const result = answer(method, params);
      return JSON.stringify({ jsonrpc: "2.0", id, result });
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      return JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: error.code, message: error.message },
      });
    }
  };

  return {
    svm,
    sent,
    deploy,
    respond,
    dropSendAt: (index: number) => {
      dropSendAt = index;
    },
    expireAt: (index: number) => {
      expireAt = index;
    },
  };
};
