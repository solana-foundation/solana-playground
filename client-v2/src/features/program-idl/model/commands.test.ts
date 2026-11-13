// @vitest-environment node
// Signing a web3.js transaction fails under jsdom, whose `Uint8Array` is another realm's
import { address, unwrapOption } from "@solana/kit";
import {
  CLOSE_DISCRIMINATOR,
  Compression,
  DataSource,
  Encoding,
  findCanonicalPda,
  findNonCanonicalPda,
  Format,
  getInitializeInstructionDataDecoder,
  getProgramDataPda,
  getSetAuthorityInstructionDataDecoder,
  getSetDataInstructionDataDecoder,
  getWriteInstructionDataDecoder,
  INITIALIZE_DISCRIMINATOR,
  packDirectData,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
  SET_AUTHORITY_DISCRIMINATOR,
  SET_DATA_DISCRIMINATOR,
  unpackDirectData,
  WRITE_DISCRIMINATOR,
} from "@solana-program/program-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

import {
  bufferOf,
  connectionOf,
  deployedBy,
  instructionsFor,
  keypairOf,
  metadataOf,
  OTHER_WALLET,
  pricesOf,
  PROGRAM,
  type StubAccount,
  stubRpc,
  WALLET,
  walletOf,
} from "./__fixtures__/chain";
import {
  closeMetadataAccountWith,
  createIdlBufferWith,
  fetchPublishedIdl,
  setBufferAuthorityWith,
  trackUnsupportedIdlCommand,
  writeMetadataFromBufferWith,
} from "./commands";

const WALLET_ADDRESS = WALLET.publicKey.toBase58();
const BUFFER = keypairOf(4).publicKey.toBase58();
const NEW_AUTHORITY = keypairOf(5).publicKey.toBase58();
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/** Micro-lamports per compute unit, unlike the default so a subcommand that drops its price fails */
const FEE = 7n;

const IDL = {
  address: PROGRAM,
  metadata: { name: "counter", version: "0.1.0", spec: "0.1.0" },
  instructions: [],
};
const PUBLISHED = JSON.stringify(IDL);
/** The IDL as a file holds it: indented and ended by a newline, so the text serialised again differs from it */
const FILE_TEXT = `${JSON.stringify(IDL, undefined, 2)}\n`;
const CANONICAL = { canonical: true, authority: undefined };

const canonicalAddress = async (seed: string) => {
  const [metadata] = await findCanonicalPda({ program: PROGRAM, seed });
  return metadata;
};

/** The connected wallet's own account of the program, which `--non-canonical` reads */
const ownAddress = async () => {
  const [own] = await findNonCanonicalPda({
    program: PROGRAM,
    authority: address(WALLET_ADDRESS),
    seed: "idl",
  });
  return own;
};

const programMetadataInstructions = instructionsFor(
  PROGRAM_METADATA_PROGRAM_ADDRESS
);

interface Setup {
  accounts: Map<string, StubAccount>;
  wallet: ReturnType<typeof walletOf>;
  connection: ReturnType<typeof connectionOf>;
}

/** The program deployed by the wallet, its published IDL, a buffer of the wallet's that holds the same IDL, and a wallet that approves */
const arrange = async (): Promise<Setup> => {
  const accounts = await deployedBy(WALLET_ADDRESS);
  accounts.set(await canonicalAddress("idl"), metadataOf(CANONICAL, PUBLISHED));
  accounts.set(
    BUFFER,
    bufferOf(WALLET_ADDRESS, packDirectData({ content: PUBLISHED }).data)
  );
  return { accounts, wallet: walletOf(WALLET), connection: connectionOf() };
};

const fetchIdl = ({ connection }: Setup) =>
  fetchPublishedIdl({ programId: PROGRAM, authority: undefined, connection });

const close = ({ connection, wallet }: Setup) =>
  closeMetadataAccountWith(FEE)({
    programId: PROGRAM,
    seed: "idl",
    connection,
    wallet,
  });

const setBufferAuthority = ({ connection, wallet }: Setup) =>
  setBufferAuthorityWith(FEE)({
    buffer: BUFFER,
    newAuthority: NEW_AUTHORITY,
    connection,
    wallet,
  });

const writeBufferAnd =
  (closeBuffer: boolean) =>
  ({ connection, wallet }: Setup) =>
    writeMetadataFromBufferWith(FEE)({
      programId: PROGRAM,
      buffer: BUFFER,
      seed: "idl",
      closeBuffer,
      connection,
      wallet,
    });

const started = (command: string) => ({
  name: "idl_command_started",
  params: { command, cluster: "devnet" },
});

const succeeded = (command: string) => ({
  name: "idl_command_succeeded",
  params: { command, cluster: "devnet" },
});

const failed = (command: string, reason: string) => ({
  name: "idl_command_failed",
  params: { command, cluster: "devnet", reason },
});

describe("features/program-idl/model/commands", () => {
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
      command: "fetch",
      reason: "not_found",
      label: "a program without a canonical account",
      change: async (setup: Setup) => {
        setup.accounts.delete(await canonicalAddress("idl"));
      },
      run: fetchIdl,
      line: `Program ${PROGRAM} has no published IDL on the selected network.`,
      sent: 0,
    },
    {
      command: "fetch",
      reason: "not_found",
      label:
        "a wallet that wrote no account for a program with a canonical one, which the line names",
      change: () => undefined,
      run: ({ connection }: Setup) =>
        fetchPublishedIdl({
          programId: PROGRAM,
          authority: WALLET_ADDRESS,
          connection,
        }),
      line: `Program ${PROGRAM} has no IDL published by ${WALLET_ADDRESS} on the selected network.`,
      sent: 0,
    },
    {
      command: "fetch",
      reason: "not_found",
      label:
        "the wallet's own account holding an unfinished upload, with no `anchor idl close` advice, which reaches only the canonical one",
      change: async (setup: Setup) => {
        setup.accounts.set(
          await ownAddress(),
          bufferOf(WALLET_ADDRESS, new Uint8Array(8))
        );
      },
      run: ({ connection }: Setup) =>
        fetchPublishedIdl({
          programId: PROGRAM,
          authority: WALLET_ADDRESS,
          connection,
        }),
      line: /\nAn upload of its IDL is unfinished: run the same `anchor idl init --non-canonical` again to finish it\.$/,
      sent: 0,
    },
    {
      command: "close",
      reason: "not_deployed",
      label: "a program id that holds no account",
      change: (setup: Setup) => {
        setup.accounts.clear();
      },
      run: close,
      line: `Program ${PROGRAM} is not deployed on the selected network.`,
      sent: 0,
    },
    {
      command: "close",
      reason: "authority",
      label:
        "a wallet that is the account's authority and not the program's upgrade authority, which the line names",
      change: async (setup: Setup) => {
        setup.accounts = await deployedBy(OTHER_WALLET);
        setup.accounts.set(
          await canonicalAddress("idl"),
          metadataOf({ canonical: true, authority: WALLET_ADDRESS }, PUBLISHED)
        );
      },
      run: close,
      line: `The program's upgrade authority is ${OTHER_WALLET}. Connect that wallet to close the metadata account.`,
      sent: 0,
    },
    {
      command: "close",
      reason: "not_found",
      label: "a seed the program has no account for",
      change: async (setup: Setup) => {
        setup.accounts.delete(await canonicalAddress("idl"));
      },
      run: close,
      line: `Program ${PROGRAM} has no metadata account for the seed "idl" on the selected network.`,
      sent: 0,
    },
    {
      command: "close",
      reason: "rejected",
      label: "an approval the wallet declines",
      change: (setup: Setup) => {
        setup.wallet.signAllTransactions = () =>
          Promise.reject(new Error("User rejected the request."));
      },
      run: close,
      line: "The wallet did not approve the IDL close, so nothing was sent.",
      sent: 0,
    },
    {
      command: "close",
      reason: "send_failed",
      label: "a transaction the cluster fails",
      change: (setup: Setup) => {
        setup.connection.confirmTransaction = async () => ({
          value: { err: { InstructionError: [1, "Custom"] } },
        });
      },
      run: close,
      line: 'IDL close transaction signature-1 failed: {"InstructionError":[1,"Custom"]}',
      sent: 1,
    },
    {
      command: "create-buffer",
      reason: "invalid",
      label: "an Anchor 0.29 IDL",
      change: () => undefined,
      run: ({ connection, wallet }: Setup) =>
        createIdlBufferWith(FEE)({
          source: {
            kind: "project",
            idl: { name: "counter", version: "0.1.0", instructions: [] },
          },
          connection,
          wallet,
        }),
      line: "The project's IDL is not in the Anchor 0.30+ format.",
      sent: 0,
    },
    {
      command: "set-buffer-authority",
      reason: "not_found",
      label: "an address that holds no account",
      change: (setup: Setup) => {
        setup.accounts.delete(BUFFER);
      },
      run: setBufferAuthority,
      line: `No Program Metadata buffer exists at ${BUFFER} on the selected network.`,
      sent: 0,
    },
    {
      command: "set-buffer-authority",
      reason: "not_found",
      label: "an address that holds a metadata account",
      change: (setup: Setup) => {
        setup.accounts.set(BUFFER, metadataOf(CANONICAL, PUBLISHED));
      },
      run: setBufferAuthority,
      line: `No Program Metadata buffer exists at ${BUFFER} on the selected network.`,
      sent: 0,
    },
    {
      command: "set-buffer-authority",
      reason: "authority",
      label: "a buffer of another wallet's, which the line names",
      change: (setup: Setup) => {
        setup.accounts.set(BUFFER, bufferOf(OTHER_WALLET, new Uint8Array()));
      },
      run: setBufferAuthority,
      line: `The buffer's authority is ${OTHER_WALLET}. Connect that wallet to set a new authority.`,
      sent: 0,
    },
    {
      command: "set-buffer-authority",
      reason: "authority",
      label: "a buffer with no authority",
      change: (setup: Setup) => {
        setup.accounts.set(BUFFER, bufferOf(undefined, new Uint8Array()));
      },
      run: setBufferAuthority,
      line: "The buffer has no authority, so no wallet can set a new one.",
      sent: 0,
    },
    {
      command: "write-buffer",
      reason: "authority",
      label: "a wallet that is not the upgrade authority, which the line names",
      change: async (setup: Setup) => {
        setup.accounts = await deployedBy(OTHER_WALLET);
        setup.accounts.set(BUFFER, bufferOf(WALLET_ADDRESS, new Uint8Array()));
      },
      run: writeBufferAnd(true),
      line: `The program's upgrade authority is ${OTHER_WALLET}. Connect that wallet to write the metadata account.`,
      sent: 0,
    },
    {
      command: "write-buffer",
      reason: "not_found",
      label: "a buffer address that holds no account",
      change: (setup: Setup) => {
        setup.accounts.delete(BUFFER);
      },
      run: writeBufferAnd(true),
      line: `No Program Metadata buffer exists at ${BUFFER} on the selected network.`,
      sent: 0,
    },
    {
      command: "write-buffer",
      reason: "invalid",
      label:
        "the buffer an unfinished upload left at the canonical address, which the write would close before reading",
      change: async (setup: Setup) => {
        setup.accounts.set(
          await canonicalAddress("idl"),
          bufferOf(WALLET_ADDRESS, new Uint8Array(8))
        );
      },
      run: async ({ connection, wallet }: Setup) =>
        writeMetadataFromBufferWith(FEE)({
          programId: PROGRAM,
          buffer: await canonicalAddress("idl"),
          seed: "idl",
          closeBuffer: true,
          connection,
          wallet,
        }),
      line: "is the program's metadata account, which holds an unfinished upload, not a buffer to write from.\nAn upload of its IDL is unfinished",
      sent: 0,
    },
  ])(
    "reports $reason from $command for $label",
    async ({ command, reason, change, run, line, sent }) => {
      const setup = await arrange();
      await change(setup);
      stubRpc(setup.accounts);

      await expect(run(setup)).rejects.toThrow(line);

      expect(tracked.events).toEqual([
        started(command),
        failed(command, reason),
      ]);
      expect(setup.connection.sent).toHaveLength(sent);
    }
  );

  it("reports an unsupported subcommand with its one event and no start", () => {
    trackUnsupportedIdlCommand("fetch-historical", Endpoint.DEVNET);

    expect(tracked.events).toEqual([failed("fetch-historical", "unsupported")]);
  });

  it("fetches the published IDL as the account holds it and reports the start, then the success", async () => {
    const setup = await arrange();
    stubRpc(setup.accounts);

    const content = await fetchIdl(setup);

    expect(content).toBe(PUBLISHED);
    expect(tracked.events).toEqual([started("fetch"), succeeded("fetch")]);
  });

  it.each([
    { label: "the upgrade authority", deployer: WALLET_ADDRESS },
    {
      label: "a wallet that is not the upgrade authority",
      deployer: OTHER_WALLET,
    },
  ])(
    "fetches the account derived from the given wallet, not the canonical one, for $label",
    async ({ deployer }) => {
      const setup = await arrange();
      const [own] = await findNonCanonicalPda({
        program: PROGRAM,
        authority: address(WALLET_ADDRESS),
        seed: "idl",
      });
      setup.accounts = await deployedBy(deployer);
      setup.accounts.set(
        await canonicalAddress("idl"),
        metadataOf(CANONICAL, PUBLISHED)
      );
      setup.accounts.set(
        own,
        metadataOf({ canonical: false, authority: WALLET_ADDRESS }, '{"own":1}')
      );
      stubRpc(setup.accounts);

      const content = await fetchPublishedIdl({
        programId: PROGRAM,
        authority: WALLET_ADDRESS,
        connection: setup.connection,
      });

      expect(content).toBe('{"own":1}');
    }
  );

  it("closes the account of the given seed, its rent to the wallet, and reports the start, then the success", async () => {
    const setup = await arrange();
    const account = await canonicalAddress("security");
    const [programData] = await getProgramDataPda(PROGRAM);
    setup.accounts.set(account, metadataOf(CANONICAL, "Contact: none"));
    stubRpc(setup.accounts);

    await closeMetadataAccountWith(FEE)({
      programId: PROGRAM,
      seed: "security",
      connection: setup.connection,
      wallet: setup.wallet,
    });

    expect(tracked.events).toEqual([started("close"), succeeded("close")]);
    expect(setup.connection.sent).toHaveLength(1);
    expect(
      programMetadataInstructions(setup.connection.sent[0]).map(
        ({ data, accounts }) => ({ data: Array.from(data), accounts })
      )
    ).toEqual([
      {
        data: [CLOSE_DISCRIMINATOR],
        accounts: [
          account,
          WALLET_ADDRESS,
          PROGRAM,
          programData,
          WALLET_ADDRESS,
        ],
      },
    ]);
    expect(pricesOf(setup.connection.sent)).toEqual([FEE]);
  });

  it.each([
    {
      label: "the IDL the project holds, serialised",
      source: { kind: "project", idl: IDL } as const,
      content: PUBLISHED,
    },
    {
      label: "the text of an IDL file, byte for byte",
      source: {
        kind: "file",
        filepath: "idl/counter.json",
        text: FILE_TEXT,
      } as const,
      content: FILE_TEXT,
    },
  ])(
    "creates a buffer of the wallet's that holds $label, returns its address, and reports the start, then the success",
    async ({ source, content }) => {
      const setup = await arrange();
      stubRpc(setup.accounts);

      const { buffer } = await createIdlBufferWith(FEE)({
        source,
        connection: setup.connection,
        wallet: setup.wallet,
      });

      expect(tracked.events).toEqual([
        started("create-buffer"),
        succeeded("create-buffer"),
      ]);
      const [create] = instructionsFor(SYSTEM_PROGRAM)(
        setup.connection.sent[0]
      );
      expect(create.accounts[1]).toBe(buffer);
      const instructions = setup.connection.sent.flatMap(
        programMetadataInstructions
      );
      const handovers = instructions
        .filter(({ data }) => data[0] === SET_AUTHORITY_DISCRIMINATOR)
        .map(({ data }) => getSetAuthorityInstructionDataDecoder().decode(data))
        .map(({ newAuthority }) => unwrapOption(newAuthority));
      expect(handovers).toEqual([WALLET_ADDRESS]);
      const written = instructions
        .filter(({ data }) => data[0] === WRITE_DISCRIMINATOR)
        .map(({ data }) => getWriteInstructionDataDecoder().decode(data))
        .map(({ data }) =>
          unpackDirectData({
            data: unwrapOption(data, () => new Uint8Array()),
            compression: Compression.Zlib,
            encoding: Encoding.Utf8,
          })
        );
      expect(written).toEqual([content]);
      expect(pricesOf(setup.connection.sent)).toEqual(
        setup.connection.sent.map(() => FEE)
      );
    }
  );

  it("sets the buffer's authority to the new key and reports the start, then the success", async () => {
    const setup = await arrange();
    stubRpc(setup.accounts);

    await setBufferAuthority(setup);

    expect(tracked.events).toEqual([
      started("set-buffer-authority"),
      succeeded("set-buffer-authority"),
    ]);
    expect(setup.connection.sent).toHaveLength(1);
    const handovers = programMetadataInstructions(setup.connection.sent[0]).map(
      ({ data, accounts }) => ({
        buffer: accounts[0],
        newAuthority: unwrapOption(
          getSetAuthorityInstructionDataDecoder().decode(data).newAuthority
        ),
      })
    );
    expect(handovers).toEqual([
      { buffer: BUFFER, newAuthority: NEW_AUTHORITY },
    ]);
    expect(pricesOf(setup.connection.sent)).toEqual([FEE]);
  });

  it.each([
    {
      label: "replaces the account that exists and closes the buffer",
      change: () => undefined,
      closeBuffer: true,
      // The instruction that states the encoding, compression, and format, and the one that names the buffer as its third account
      describes: SET_DATA_DISCRIMINATOR,
      decoder: getSetDataInstructionDataDecoder(),
      copies: SET_DATA_DISCRIMINATOR,
      closed: [BUFFER],
    },
    {
      label: "creates the account that is missing and keeps the buffer",
      change: async (setup: Setup) => {
        setup.accounts.delete(await canonicalAddress("idl"));
      },
      closeBuffer: false,
      describes: INITIALIZE_DISCRIMINATOR,
      decoder: getInitializeInstructionDataDecoder(),
      copies: WRITE_DISCRIMINATOR,
      closed: [],
    },
  ])(
    "$label from the buffer's data, stored as zlib and UTF-8 with no format, and reports the start, then the success",
    async ({ change, closeBuffer, describes, decoder, copies, closed }) => {
      const setup = await arrange();
      await change(setup);
      stubRpc(setup.accounts);

      await writeBufferAnd(closeBuffer)(setup);

      expect(tracked.events).toEqual([
        started("write-buffer"),
        succeeded("write-buffer"),
      ]);
      const instructions = setup.connection.sent.flatMap(
        programMetadataInstructions
      );
      const stored = instructions
        .filter(({ data }) => data[0] === describes)
        .map(({ data }) => decoder.decode(data))
        .map(({ encoding, compression, format, dataSource }) => ({
          encoding,
          compression,
          format,
          dataSource,
        }));
      expect(stored).toEqual([
        {
          encoding: Encoding.Utf8,
          compression: Compression.Zlib,
          format: Format.None,
          dataSource: DataSource.Direct,
        },
      ]);
      const sources = instructions
        .filter(({ data }) => data[0] === copies)
        .map(({ accounts }) => accounts[2]);
      expect(sources).toEqual([BUFFER]);
      const closes = instructions
        .filter(({ data }) => data[0] === CLOSE_DISCRIMINATOR)
        .map(({ accounts }) => accounts[0]);
      expect(closes).toEqual(closed);
      expect(pricesOf(setup.connection.sent)).toEqual(
        setup.connection.sent.map(() => FEE)
      );
    }
  );
});
