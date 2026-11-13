// Test-only fakes of a cluster, a wallet, and a connection; nothing outside `*.test.ts` imports this
import {
  address,
  getAddressEncoder,
  getBase64Decoder,
  getOptionEncoder,
  getStructEncoder,
  getU32Encoder,
  getU64Encoder,
  none,
  type ReadonlyUint8Array,
  some,
} from "@solana/kit";
import {
  ComputeBudgetProgram,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  Compression,
  DataSource,
  Encoding,
  Format,
  getBufferEncoder,
  getMetadataEncoder,
  getProgramDataPda,
  LOADER_V3_PROGRAM_ADDRESS,
  packDirectData,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
} from "@solana-program/program-metadata";
import { vi } from "vitest";

import { Endpoint } from "@/entities/cluster";

export interface StubAccount {
  owner: string;
  executable: boolean;
  data: ReadonlyUint8Array;
}

export const keypairOf = (seed: number) =>
  Keypair.fromSeed(new Uint8Array(32).fill(seed));
export const WALLET = keypairOf(1);
export const PROGRAM = address(keypairOf(2).publicKey.toBase58());
export const OTHER_WALLET = keypairOf(3).publicKey.toBase58();

/** The accounts of the deployed program whose upgrade authority is `authority`, or that has none */
export const deployedBy = async (authority: string | undefined) => {
  const [programData] = await getProgramDataPda(PROGRAM);
  return new Map<string, StubAccount>([
    [
      PROGRAM,
      {
        owner: LOADER_V3_PROGRAM_ADDRESS,
        executable: true,
        data: getStructEncoder([
          ["discriminator", getU32Encoder()],
          ["programData", getAddressEncoder()],
        ]).encode({ discriminator: 2, programData }),
      },
    ],
    [
      programData,
      {
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
      },
    ],
  ]);
};

/** A Program Metadata account of the program that holds `content` as an upload packs it */
export const metadataOf = (
  {
    canonical,
    authority,
  }: { canonical: boolean; authority: string | undefined },
  content: string
): StubAccount => {
  const { data } = packDirectData({ content });
  return {
    owner: PROGRAM_METADATA_PROGRAM_ADDRESS,
    executable: false,
    data: getMetadataEncoder().encode({
      program: PROGRAM,
      authority: authority ? some(address(authority)) : none(),
      mutable: true,
      canonical,
      seed: "idl",
      encoding: Encoding.Utf8,
      compression: Compression.Zlib,
      format: Format.Json,
      dataSource: DataSource.Direct,
      dataLength: data.length,
      data,
    }),
  };
};

/** A Program Metadata buffer account that holds `data` and has `authority`, or none, as its authority */
export const bufferOf = (
  authority: string | undefined,
  data: ReadonlyUint8Array
): StubAccount => ({
  owner: PROGRAM_METADATA_PROGRAM_ADDRESS,
  executable: false,
  data: getBufferEncoder().encode({
    program: none(),
    authority: authority ? some(address(authority)) : none(),
    canonical: false,
    seed: "",
    data,
  }),
});

/** The last valid block height of every blockhash the stub RPC hands out */
const LAST_VALID_BLOCK_HEIGHT = 100;

const answerWith =
  (blockHeight: number) =>
  (
    accounts: Map<string, StubAccount>,
    { method, params }: { method: string; params: unknown[] }
  ) => {
    if (method === "getAccountInfo") {
      const account = accounts.get(String(params[0]));
      return {
        context: { slot: 1 },
        value: account
          ? {
              data: [getBase64Decoder().decode(account.data), "base64"],
              executable: account.executable,
              lamports: 1,
              owner: account.owner,
              rentEpoch: 0,
              space: account.data.length,
            }
          : // eslint-disable-next-line unicorn/no-null -- the RPC answers `null` for an address that holds no account
            null,
      };
    }
    if (method === "getLatestBlockhash") {
      return {
        context: { slot: 1 },
        value: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
        },
      };
    }
    if (method === "getBlockHeight") return blockHeight;
    if (method === "getMinimumBalanceForRentExemption") return 890_880;
    throw new Error(`The stub RPC has no answer for ${method}`);
  };

/** Answers the RPC's requests from `accounts`, read at each request so a case may change them, at the block height `blockHeight` */
const stubRpcWith =
  (blockHeight: number) => (accounts: Map<string, StubAccount>) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const { id, method, params } = JSON.parse(String(init?.body));
      const result = answerWith(blockHeight)(accounts, { method, params });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });

/** Under the last valid block height, so a failed send is not read as an expired one */
export const stubRpc = stubRpcWith(1);

/** Past the last valid block height, so a failed send is read as an expired one unless something says the transaction itself failed */
export const stubExpiredRpc = stubRpcWith(LAST_VALID_BLOCK_HEIGHT + 1);

/** Signs with `keypair`, leaving a v0 transaction unsigned as a wallet that tests `version` for truthiness does */
export const walletOf = (keypair: Keypair) => {
  const requests: VersionedTransaction[][] = [];
  return {
    publicKey: keypair.publicKey,
    requests,
    signAllTransactions: async (txs: VersionedTransaction[]) => {
      requests.push(txs);
      for (const tx of txs) if (tx.version) tx.sign([keypair]);
      return txs;
    },
  };
};

/** Confirms every transaction and records the order of the sends and confirmations */
export const connectionOf = () => {
  const sent: Uint8Array[] = [];
  const steps: string[] = [];
  return {
    rpcEndpoint: Endpoint.DEVNET as string, // one of the Playground's own, so the events name `devnet`
    sent,
    steps,
    sendRawTransaction: async (raw: Uint8Array) => {
      sent.push(raw);
      steps.push("send");
      return `signature-${sent.length}`;
    },
    confirmTransaction: async (): Promise<{ value: { err: unknown } }> => {
      steps.push("confirm");
      return { value: { err: undefined } };
    },
  };
};

/** The instructions a sent transaction holds for `program`: the data of each and the addresses of its accounts, in order */
export const instructionsFor = (program: string) => (raw: Uint8Array) => {
  const { message } = VersionedTransaction.deserialize(raw);
  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  return message.compiledInstructions
    .filter(({ programIdIndex }) => keys[programIdIndex] === program)
    .map(({ data, accountKeyIndexes }) => ({
      data,
      accounts: accountKeyIndexes.map((index) => keys[index]),
    }));
};

/** The first byte of the Compute Budget instruction that sets a compute-unit price */
const SET_COMPUTE_UNIT_PRICE = 3;

/** The compute-unit price each sent transaction sets, in micro-lamports; `undefined` for a transaction that sets none */
export const pricesOf = (sent: Uint8Array[]) =>
  sent.map((raw) => {
    const [price] = instructionsFor(ComputeBudgetProgram.programId.toBase58())(
      raw
    ).filter(({ data }) => data[0] === SET_COMPUTE_UNIT_PRICE);
    return price
      ? new DataView(price.data.buffer, price.data.byteOffset).getBigUint64(
          1,
          true
        )
      : undefined;
  });
