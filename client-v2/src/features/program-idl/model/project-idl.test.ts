// @vitest-environment node
// Signing a web3.js transaction fails under jsdom, whose `Uint8Array` is another realm's
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
  unwrapOption,
} from "@solana/kit";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import {
  Compression,
  DataSource,
  Encoding,
  findCanonicalPda,
  Format,
  getInitializeInstructionDataDecoder,
  getMetadataEncoder,
  getProgramDataPda,
  LOADER_V3_PROGRAM_ADDRESS,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
  unpackDirectData,
} from "@solana-program/program-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Endpoint } from "@/entities/cluster";
import {
  initLogger,
  memoryProvider as logMemoryProvider,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

import { uploadProjectIdl } from "./project-idl";

interface StubAccount {
  owner: string;
  executable: boolean;
  data: ReadonlyUint8Array;
}

const keypairOf = (seed: number) =>
  Keypair.fromSeed(new Uint8Array(32).fill(seed));
const WALLET = keypairOf(1);
const PROGRAM = address(keypairOf(2).publicKey.toBase58());
const OTHER_WALLET = keypairOf(3).publicKey.toBase58();

/** The accounts of the deployed program whose upgrade authority is `authority`, or that has none */
const deployedBy = async (authority: string | undefined) => {
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

const idlAddress = async () => {
  const [metadata] = await findCanonicalPda({ program: PROGRAM, seed: "idl" });
  return metadata;
};

/** A canonical Program Metadata account that already holds two bytes of IDL */
const earlierIdl = (): StubAccount => ({
  owner: PROGRAM_METADATA_PROGRAM_ADDRESS,
  executable: false,
  data: getMetadataEncoder().encode({
    program: PROGRAM,
    authority: none(),
    mutable: true,
    canonical: true,
    seed: "idl",
    encoding: Encoding.Utf8,
    compression: Compression.Zlib,
    format: Format.Json,
    dataSource: DataSource.Direct,
    dataLength: 2,
    data: new Uint8Array([1, 2]),
  }),
});

const answer = (
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
        lastValidBlockHeight: 100,
      },
    };
  }
  if (method === "getMinimumBalanceForRentExemption") return 890_880;
  throw new Error(`The stub RPC has no answer for ${method}`);
};

/** Answers the RPC's requests from `accounts`, read at each request so a case may change them */
const stubRpc = (accounts: Map<string, StubAccount>) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body));
    const result = answer(accounts, { method, params });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });

/** Signs with `keypair`, leaving a v0 transaction unsigned as a wallet that tests `version` for truthiness does */
const walletOf = (keypair: Keypair) => {
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
const connectionOf = () => {
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

/** An Anchor 0.30+ IDL; a long `description` makes it larger than one transaction */
const idlWith = (description: string) => ({
  address: PROGRAM,
  metadata: { name: "counter", version: "0.1.0", spec: "0.1.0", description },
  instructions: [],
});

/** Text that zlib cannot shrink much, the same on every run */
const noise = (length: number) => {
  let state = 1;
  return Array.from({ length }, () => {
    state = (state * 48_271) % 2_147_483_647;
    return (state % 36).toString(36);
  }).join("");
};

interface Setup {
  idl: object | undefined;
  accounts: Map<string, StubAccount>;
  wallet: ReturnType<typeof walletOf>;
  connection: ReturnType<typeof connectionOf>;
}

/** A small IDL, the program deployed by the wallet, no earlier IDL, and a wallet that approves */
const arrange = async (): Promise<Setup> => ({
  idl: idlWith("A counter"),
  accounts: await deployedBy(WALLET.publicKey.toBase58()),
  wallet: walletOf(WALLET),
  connection: connectionOf(),
});

const run = ({ idl, accounts, wallet, connection }: Setup) => {
  stubRpc(accounts);
  return uploadProjectIdl({ idl, programId: PROGRAM, connection, wallet });
};

describe("features/program-idl/model/project-idl", () => {
  let tracked: ReturnType<typeof memoryProvider>;

  beforeEach(() => {
    tracked = memoryProvider();
    initTelemetry({ providers: [tracked] });
    initLogger({ providers: [logMemoryProvider()] });
  });

  afterEach(() => {
    resetTelemetry();
    resetLogger();
  });

  it.each([
    {
      reason: "not_found",
      label: "a project without an IDL",
      change: (setup: Setup) => {
        setup.idl = undefined;
      },
      line: "The project has no IDL to upload.",
      sent: 0,
    },
    {
      reason: "invalid",
      label: "an Anchor 0.29 IDL",
      change: (setup: Setup) => {
        setup.idl = { name: "counter", version: "0.1.0", instructions: [] };
      },
      line: "The project's IDL is not in the Anchor 0.30+ format.",
      sent: 0,
    },
    {
      reason: "not_deployed",
      label: "a program id that holds no account",
      change: (setup: Setup) => {
        setup.accounts.clear();
      },
      line: `Program ${PROGRAM} is not deployed on the selected network.`,
      sent: 0,
    },
    {
      reason: "not_deployed",
      label: "a program id that holds a wallet's account",
      change: (setup: Setup) => {
        setup.accounts.set(PROGRAM, {
          owner: "11111111111111111111111111111111",
          executable: false,
          data: new Uint8Array(),
        });
      },
      line: `Program ${PROGRAM} is not deployed on the selected network.`,
      sent: 0,
    },
    {
      reason: "authority",
      label: "a wallet that is not the upgrade authority, which the line names",
      change: async (setup: Setup) => {
        setup.accounts = await deployedBy(OTHER_WALLET);
      },
      line: `The program's upgrade authority is ${OTHER_WALLET}. Connect that wallet to upload the IDL.`,
      sent: 0,
    },
    {
      reason: "authority",
      label: "a program with no upgrade authority",
      change: async (setup: Setup) => {
        setup.accounts = await deployedBy(undefined);
      },
      line: "The program has no upgrade authority, so no wallet can upload its IDL.",
      sent: 0,
    },
    {
      reason: "rejected",
      label: "an approval the wallet declines",
      change: (setup: Setup) => {
        setup.wallet.signAllTransactions = () =>
          Promise.reject(new Error("User rejected the request."));
      },
      line: "The wallet did not approve the IDL upload, so nothing was sent.",
      sent: 0,
    },
    {
      reason: "rpc",
      label: "a transaction the cluster fails",
      change: (setup: Setup) => {
        setup.connection.confirmTransaction = async () => ({
          value: { err: { InstructionError: [1, "Custom"] } },
        });
      },
      line: 'IDL upload transaction signature-1 failed: {"InstructionError":[1,"Custom"]}',
      sent: 1,
    },
  ])("reports $reason for $label", async ({ reason, change, line, sent }) => {
    const setup = await arrange();
    await change(setup);

    await expect(run(setup)).rejects.toThrow(line);

    expect(tracked.events).toEqual([
      {
        name: "idl_upload_started",
        params: { target: "metadata", cluster: "devnet" },
      },
      {
        name: "idl_upload_failed",
        params: { target: "metadata", cluster: "devnet", reason },
      },
    ]);
    expect(setup.connection.sent).toHaveLength(sent);
  });

  it("names the cluster custom for an endpoint that is not one of the Playground's own", async () => {
    const setup = await arrange();
    setup.idl = undefined;
    setup.connection.rpcEndpoint = "https://devnet.custom-rpc.test";

    await expect(run(setup)).rejects.toThrow(
      "The project has no IDL to upload."
    );

    expect(tracked.events).toEqual([
      {
        name: "idl_upload_started",
        params: { target: "metadata", cluster: "custom" },
      },
      {
        name: "idl_upload_failed",
        params: { target: "metadata", cluster: "custom", reason: "not_found" },
      },
    ]);
  });

  it("uploads the JSON the project holds and reports the start, then the upload", async () => {
    const setup = await arrange();

    const result = await run(setup);

    expect(result).toEqual({ metadata: await idlAddress(), action: "created" });
    expect(tracked.events).toEqual([
      {
        name: "idl_upload_started",
        params: { target: "metadata", cluster: "devnet" },
      },
      {
        name: "idl_uploaded",
        params: { target: "metadata", cluster: "devnet" },
      },
    ]);
    const { message } = VersionedTransaction.deserialize(
      setup.connection.sent[0]
    );
    const written = message.compiledInstructions
      .filter(
        ({ programIdIndex }) =>
          message.staticAccountKeys[programIdIndex].toBase58() ===
          PROGRAM_METADATA_PROGRAM_ADDRESS
      )
      .map(({ data }) => getInitializeInstructionDataDecoder().decode(data))
      .map(({ data, compression, encoding }) =>
        unpackDirectData({
          data: unwrapOption(data, () => new Uint8Array()),
          compression,
          encoding,
        })
      );
    expect(written).toEqual([JSON.stringify(setup.idl)]);
  });

  it("replaces a large IDL with one approval, every transaction fully signed and sent in stage order", async () => {
    const setup = await arrange();
    setup.idl = idlWith(noise(2500));
    setup.accounts.set(await idlAddress(), earlierIdl());

    const result = await run(setup);

    expect(result.action).toBe("replaced");
    expect(setup.wallet.requests).toHaveLength(1);
    const signatures = setup.connection.sent.map(
      (raw) => VersionedTransaction.deserialize(raw).signatures
    );
    expect(signatures).toHaveLength(setup.wallet.requests[0].length);
    // The transaction that creates the buffer account carries its keypair's signature beside the wallet's
    expect(signatures.map((of) => of.length)).toContain(2);
    const unsigned = signatures
      .flat()
      .filter((signature) => signature.every((byte) => byte === 0));
    expect(unsigned).toHaveLength(0);
    expect(setup.connection.steps.slice(0, 2)).toEqual(["send", "confirm"]);
    expect(setup.connection.steps.slice(-2)).toEqual(["send", "confirm"]);
  });
});
