// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md). Every case
// runs through `PgCommandManager.execute`, which finds the subcommand and
// parses its arguments and options as the terminal does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Endpoint } from "@/entities/cluster";
import {
  DEFAULT_PRIORITY_FEE,
  IdlCommandRefusedError,
} from "@/features/program-idl";
import {
  connectionOf,
  deployedBy,
  PROGRAM,
  stubRpc,
} from "@/features/program-idl/model/__fixtures__/chain";
import { ANCHOR_VERSION } from "@/shared/config/build-server";
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

import { PgConnection, PgExplorer, PgGlobal } from "../../utils";
import { PgCommandManager } from "../../utils/command";
import { PgTerminal, TerminalLineError } from "../../utils/terminal";
import {
  IDL_NETWORK_CHANGED,
  IDL_NETWORK_UNREAD,
  MAINNET_IDL_BLOCKED,
} from "../deploy/mainnet-block";
import { anchor } from "./anchor";

const PROJECT_PROGRAM = "SysvarRent111111111111111111111111111111111";
const GIVEN_PROGRAM = "SysvarC1ock11111111111111111111111111111111";
const FILE_PROGRAM = "SysvarStakeHistory1111111111111111111111111";
const METADATA = "BPFLoaderUpgradeab1e11111111111111111111111";
const BUFFER = "SysvarRecentB1ockHashes11111111111111111111";
const NEW_AUTHORITY = "SysvarEpochSchedu1e111111111111111111111111";
const WALLET_ADDRESS = "Sysvar1nstructions1111111111111111111111111";

/** An external wallet, which approves: the program's upgrade authority need not be the Playground wallet */
const WALLET = {
  isPg: false,
  publicKey: { toBase58: () => WALLET_ADDRESS },
  // Stand-ins for the signed transactions: web3.js cannot serialise one under jsdom, whose `Uint8Array` is another realm's
  signAllTransactions: async (txs: unknown[]) =>
    txs.map(() => ({ serialize: () => new Uint8Array() })),
};
const CONNECTION = { rpcEndpoint: Endpoint.DEVNET as string };
/** A custom RPC that serves mainnet: none of the Playground's own endpoints, so the events name it `custom` */
const CUSTOM_MAINNET = "https://mainnet.custom-rpc.test";

/** An Anchor 0.30+ IDL */
const idlFor = (address: string | undefined) => ({
  address,
  metadata: { name: "counter", version: "0.1.0", spec: "0.1.0" },
  instructions: [],
});
const PROJECT_IDL = idlFor(PROJECT_PROGRAM);
const FILE_IDL = idlFor(FILE_PROGRAM);
/** A file as `anchor build` writes one: indented, with a newline at its end, so text serialised again differs from it */
const FILE_TEXT = `${JSON.stringify(FILE_IDL, undefined, 2)}\n`;
/** An Anchor 0.30+ IDL the Playground cannot map to the 0.29 shape: an argument of an unbound generic type */
const UNMAPPABLE_IDL = {
  address: FILE_PROGRAM,
  metadata: { name: "counter", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "set",
      discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      accounts: [],
      args: [{ name: "value", type: { generic: "T" } }],
    },
  ],
};
const UNMAPPABLE_TEXT = JSON.stringify(UNMAPPABLE_IDL);

/** What the project holds, by path */
const PROJECT_FILES = new Map([
  ["idl/counter.json", FILE_TEXT],
  ["idl/unmappable.json", UNMAPPABLE_TEXT],
  ["idl/no-address.json", JSON.stringify(idlFor(undefined))],
  // The Anchor 0.29 format, with no `metadata.address` for Anchor to find a program in
  [
    "idl/legacy.json",
    JSON.stringify({ name: "counter", version: "0.1.0", instructions: [] }),
  ],
  ["idl/broken.json", "{"],
]);

/** What `PgTerminal.get` rejects with: the wallet question reaches the terminal through it */
const WALLET_QUESTION = "The command asked a wallet question";

const env = vi.hoisted(() => ({
  wallet: undefined as typeof WALLET | undefined, // What `PgWallet.current` answers; `undefined` is no wallet connected
  connection: { rpcEndpoint: "" }, // What `PgConnection.current` answers
  programId: undefined as string | undefined, // The project's program id; `undefined` is a project without one
  idl: undefined as object | undefined, // The IDL the project holds; `undefined` is a project without one
}));

const slice = vi.hoisted(() => ({
  uploadProjectIdlWith: vi.fn(),
  upload: vi.fn(),
  uploadNonCanonicalProjectIdlWith: vi.fn(),
  uploadNonCanonical: vi.fn(),
  closeMetadataAccountWith: vi.fn(),
  close: vi.fn(),
  createIdlBufferWith: vi.fn(),
  createBuffer: vi.fn(),
  setBufferAuthorityWith: vi.fn(),
  setBufferAuthority: vi.fn(),
  writeMetadataFromBufferWith: vi.fn(),
  writeBuffer: vi.fn(),
  fetchPublishedIdl: vi.fn(),
  trackUnsupportedIdlCommand: vi.fn(),
}));

/** Each entry of the slice that sends, with what it returns once it has the priority fee */
const SENDING_ENTRIES = [
  [slice.uploadProjectIdlWith, slice.upload],
  [slice.uploadNonCanonicalProjectIdlWith, slice.uploadNonCanonical],
  [slice.closeMetadataAccountWith, slice.close],
  [slice.createIdlBufferWith, slice.createBuffer],
  [slice.setBufferAuthorityWith, slice.setBufferAuthority],
  [slice.writeMetadataFromBufferWith, slice.writeBuffer],
] as const;

const applyFile = vi.hoisted(() => vi.fn());

vi.mock("@/features/program-idl", async () => {
  const actual = await vi.importActual<typeof import("@/features/program-idl")>(
    "@/features/program-idl"
  );
  return {
    DEFAULT_PRIORITY_FEE: actual.DEFAULT_PRIORITY_FEE,
    IDL_SEED: actual.IDL_SEED,
    IdlCommandRefusedError: actual.IdlCommandRefusedError,
    UnfinishedIdlUploadError: actual.UnfinishedIdlUploadError,
    IdlSendExpiredError: actual.IdlSendExpiredError,
    uploadProjectIdlWith: slice.uploadProjectIdlWith,
    uploadNonCanonicalProjectIdlWith: slice.uploadNonCanonicalProjectIdlWith,
    closeMetadataAccountWith: slice.closeMetadataAccountWith,
    createIdlBufferWith: slice.createIdlBufferWith,
    setBufferAuthorityWith: slice.setBufferAuthorityWith,
    writeMetadataFromBufferWith: slice.writeMetadataFromBufferWith,
    fetchPublishedIdl: slice.fetchPublishedIdl,
    trackRefusedIdlSendFor: actual.trackRefusedIdlSendFor,
    trackUnsupportedIdlCommand: slice.trackUnsupportedIdlCommand,
  };
});

vi.mock("../../utils/explorer/apply-file", () => ({ applyFile }));

vi.mock("../../utils", async () => {
  const terminal = await import("../../utils/terminal");
  const explorer = await import("../../utils/explorer/explorer");
  const command = await import("../../utils/command");
  return {
    TerminalLineError: terminal.TerminalLineError,
    PgTerminal: terminal.PgTerminal,
    PgExplorer: explorer.PgExplorer,
    PgCommandManager: command.PgCommandManager,
    PgGlobal: { isIdlWriting: false },
    PgConnection: {
      get current() {
        return env.connection;
      },
      getCluster: vi.fn(),
    },
    PgProgramInfo: {
      get idl() {
        // eslint-disable-next-line unicorn/no-null -- `PgProgramInfo.idl` is `null` for a project without an IDL
        return env.idl ?? null;
      },
      // eslint-disable-next-line unicorn/no-null -- `getPkStr` answers `null` for a project without a program ID
      getPkStr: () => env.programId ?? null,
    },
    PgWallet: {
      get current() {
        return env.wallet;
      },
    },
  };
});

const run = (line: string) => PgCommandManager.execute(line.split(" "));

/** No entry of the slice that sends ran, so the command sent no transaction and no event */
const expectNothingSent = () => {
  for (const [, entry] of SENDING_ENTRIES) {
    expect(entry).not.toHaveBeenCalled();
  }
};

/** What the terminal printed, one entry for each `println` */
const printed = () => vi.mocked(PgTerminal.println).mock.calls;

/** The two events of an upload that ended before the slice's entry ran */
const refusedUpload = (cluster: string, reason: string) => [
  { name: "idl_upload_started", params: { target: "metadata", cluster } },
  {
    name: "idl_upload_failed",
    params: { target: "metadata", cluster, reason },
  },
];

/** The two events of another subcommand that sends and ended before the slice's entry ran */
const refusedCommand = (command: string, cluster: string) => [
  { name: "idl_command_started", params: { command, cluster } },
  {
    name: "idl_command_failed",
    params: { command, cluster, reason: "mainnet" },
  },
];

describe("commands/anchor", () => {
  let saved: typeof PgCommandManager.all;
  let tracked: ReturnType<typeof memoryProvider>;

  /** No entry of the slice ran and the command recorded no attempt: no transaction and no event */
  const expectNoAttempt = () => {
    expectNothingSent();
    expect(tracked.events).toEqual([]);
  };

  beforeEach(() => {
    saved = PgCommandManager.all;
    PgCommandManager.all = { anchor } as never;
    tracked = memoryProvider();
    initTelemetry({ providers: [tracked] });
    initLogger({ providers: [logMemoryProvider()] });
    // The terminal prints a failure and rethrows it; only the rethrow matters here
    vi.spyOn(PgTerminal, "process").mockImplementation(async (cb) => cb());
    vi.spyOn(PgTerminal, "println").mockResolvedValue();
    vi.spyOn(PgTerminal, "get").mockRejectedValue(new Error(WALLET_QUESTION));
    vi.spyOn(PgExplorer, "getFileContent").mockImplementation((path) =>
      PROJECT_FILES.get(path)
    );

    env.wallet = WALLET;
    env.connection = CONNECTION;
    env.programId = PROJECT_PROGRAM;
    env.idl = PROJECT_IDL;
    PgGlobal.isIdlWriting = false;
    vi.mocked(PgConnection.getCluster).mockReset().mockResolvedValue("devnet");

    for (const [entryWith, entry] of SENDING_ENTRIES) {
      entry.mockReset();
      entryWith.mockReset().mockReturnValue(entry);
    }
    slice.upload.mockResolvedValue({ metadata: METADATA, action: "created" });
    slice.uploadNonCanonical.mockResolvedValue({
      metadata: METADATA,
      action: "created",
    });
    slice.createBuffer.mockResolvedValue({ buffer: BUFFER });
    slice.fetchPublishedIdl.mockReset();
    slice.trackUnsupportedIdlCommand.mockReset();
    applyFile.mockReset();
  });

  afterEach(() => {
    PgCommandManager.all = saved;
    resetTelemetry();
    resetLogger();
    vi.restoreAllMocks();
  });

  it.each([
    {
      line: "anchor idl init",
      entryWith: slice.uploadProjectIdlWith,
      entry: slice.upload,
      fee: DEFAULT_PRIORITY_FEE,
      input: {
        source: { kind: "project", idl: PROJECT_IDL },
        programId: PROJECT_PROGRAM,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: `${PgTerminal.success(
        "IDL initialized."
      )} Program Metadata account: ${METADATA}`,
    },
    {
      line: `anchor idl upgrade ${GIVEN_PROGRAM}`,
      entryWith: slice.uploadProjectIdlWith,
      entry: slice.upload,
      fee: DEFAULT_PRIORITY_FEE,
      input: {
        source: { kind: "project", idl: PROJECT_IDL },
        programId: GIVEN_PROGRAM,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: `${PgTerminal.success(
        "IDL upgraded."
      )} Program Metadata account: ${METADATA}`,
    },
    {
      line: "anchor idl init --filepath idl/counter.json --priority-fee 7",
      entryWith: slice.uploadProjectIdlWith,
      entry: slice.upload,
      fee: 7n,
      input: {
        source: { kind: "file", filepath: "idl/counter.json", text: FILE_TEXT },
        programId: FILE_PROGRAM,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: `${PgTerminal.success(
        "IDL initialized."
      )} Program Metadata account: ${METADATA}`,
    },
    {
      line: "anchor idl upgrade --filepath idl/unmappable.json",
      entryWith: slice.uploadProjectIdlWith,
      entry: slice.upload,
      fee: DEFAULT_PRIORITY_FEE,
      input: {
        source: {
          kind: "file",
          filepath: "idl/unmappable.json",
          text: UNMAPPABLE_TEXT,
        },
        programId: FILE_PROGRAM,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: `${PgTerminal.success(
        "IDL upgraded."
      )} Program Metadata account: ${METADATA}`,
    },
    {
      line: `anchor idl upgrade -f idl/counter.json ${GIVEN_PROGRAM} --priority-fee 7`,
      entryWith: slice.uploadProjectIdlWith,
      entry: slice.upload,
      fee: 7n,
      input: {
        source: { kind: "file", filepath: "idl/counter.json", text: FILE_TEXT },
        programId: GIVEN_PROGRAM,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: `${PgTerminal.success(
        "IDL upgraded."
      )} Program Metadata account: ${METADATA}`,
    },
    {
      line: `anchor idl init ${GIVEN_PROGRAM} --non-canonical`,
      entryWith: slice.uploadNonCanonicalProjectIdlWith,
      entry: slice.uploadNonCanonical,
      fee: DEFAULT_PRIORITY_FEE,
      input: {
        source: { kind: "project", idl: PROJECT_IDL },
        programId: GIVEN_PROGRAM,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: `${PgTerminal.success(
        "IDL initialized."
      )} Program Metadata account: ${METADATA}`,
    },
    {
      line: `anchor idl close ${GIVEN_PROGRAM}`,
      entryWith: slice.closeMetadataAccountWith,
      entry: slice.close,
      fee: DEFAULT_PRIORITY_FEE,
      input: {
        programId: GIVEN_PROGRAM,
        seed: "idl",
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: PgTerminal.success("Metadata account closed successfully."),
    },
    {
      line: `anchor idl close ${GIVEN_PROGRAM} --seed security --priority-fee 7`,
      entryWith: slice.closeMetadataAccountWith,
      entry: slice.close,
      fee: 7n,
      input: {
        programId: GIVEN_PROGRAM,
        seed: "security",
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: PgTerminal.success("Metadata account closed successfully."),
    },
    {
      line: "anchor idl create-buffer",
      entryWith: slice.createIdlBufferWith,
      entry: slice.createBuffer,
      fee: DEFAULT_PRIORITY_FEE,
      input: {
        source: { kind: "project", idl: PROJECT_IDL },
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: `${PgTerminal.success(
        "Buffer created successfully."
      )} Buffer account: ${BUFFER}`,
    },
    {
      line: "anchor idl create-buffer -f idl/counter.json --priority-fee 7",
      entryWith: slice.createIdlBufferWith,
      entry: slice.createBuffer,
      fee: 7n,
      input: {
        source: { kind: "file", filepath: "idl/counter.json", text: FILE_TEXT },
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: `${PgTerminal.success(
        "Buffer created successfully."
      )} Buffer account: ${BUFFER}`,
    },
    {
      line: `anchor idl set-buffer-authority ${BUFFER} --new-authority ${NEW_AUTHORITY}`,
      entryWith: slice.setBufferAuthorityWith,
      entry: slice.setBufferAuthority,
      fee: DEFAULT_PRIORITY_FEE,
      input: {
        buffer: BUFFER,
        newAuthority: NEW_AUTHORITY,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: PgTerminal.success("Buffer authority set successfully."),
    },
    {
      line: `anchor idl set-buffer-authority ${BUFFER} -n ${NEW_AUTHORITY} --priority-fee 7`,
      entryWith: slice.setBufferAuthorityWith,
      entry: slice.setBufferAuthority,
      fee: 7n,
      input: {
        buffer: BUFFER,
        newAuthority: NEW_AUTHORITY,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: PgTerminal.success("Buffer authority set successfully."),
    },
    {
      line: `anchor idl write-buffer ${GIVEN_PROGRAM} --buffer ${BUFFER}`,
      entryWith: slice.writeMetadataFromBufferWith,
      entry: slice.writeBuffer,
      fee: DEFAULT_PRIORITY_FEE,
      input: {
        programId: GIVEN_PROGRAM,
        buffer: BUFFER,
        seed: "idl",
        closeBuffer: false,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: PgTerminal.success("Metadata written successfully using buffer."),
    },
    {
      line: `anchor idl write-buffer ${GIVEN_PROGRAM} -b ${BUFFER} --seed security --close-buffer --priority-fee 7`,
      entryWith: slice.writeMetadataFromBufferWith,
      entry: slice.writeBuffer,
      fee: 7n,
      input: {
        programId: GIVEN_PROGRAM,
        buffer: BUFFER,
        seed: "security",
        closeBuffer: true,
        connection: CONNECTION,
        wallet: WALLET,
      },
      output: PgTerminal.success("Metadata written successfully using buffer."),
    },
  ])(
    "hands `$line` to the slice at its priority fee and prints Anchor's line",
    async ({ line, entryWith, entry, fee, input, output }) => {
      await run(line);

      expect(entryWith).toHaveBeenCalledWith(fee);
      expect(entry).toHaveBeenCalledWith(input);
      expect(printed()).toEqual([[output]]);
      // The entry, a double here, records an attempt that reaches it; the command adds no event of its own
      expect(tracked.events).toEqual([]);
    }
  );

  // The slice's own entry, in front of a cluster that confirms every transaction
  it("records one start and one success for an upload that reaches the slice's entry", async () => {
    const actual = await vi.importActual<
      typeof import("@/features/program-idl")
    >("@/features/program-idl");
    slice.uploadProjectIdlWith.mockImplementation(actual.uploadProjectIdlWith);
    stubRpc(await deployedBy(WALLET_ADDRESS));
    env.connection = connectionOf();

    await run(`anchor idl init ${PROGRAM}`);

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
  });

  it.each([
    {
      line: "anchor idl init",
      endpoint: Endpoint.MAINNET_BETA,
      events: refusedUpload("mainnet", "mainnet"),
    },
    {
      line: "anchor idl upgrade",
      endpoint: CUSTOM_MAINNET,
      events: refusedUpload("custom", "mainnet"),
    },
    {
      line: `anchor idl close ${GIVEN_PROGRAM}`,
      endpoint: Endpoint.MAINNET_BETA,
      events: refusedCommand("close", "mainnet"),
    },
    {
      line: "anchor idl create-buffer",
      endpoint: CUSTOM_MAINNET,
      events: refusedCommand("create-buffer", "custom"),
    },
    {
      line: `anchor idl set-buffer-authority ${BUFFER} --new-authority ${NEW_AUTHORITY}`,
      endpoint: Endpoint.MAINNET_BETA,
      events: refusedCommand("set-buffer-authority", "mainnet"),
    },
    {
      line: `anchor idl write-buffer ${GIVEN_PROGRAM} --buffer ${BUFFER}`,
      endpoint: CUSTOM_MAINNET,
      events: refusedCommand("write-buffer", "custom"),
    },
  ])(
    "refuses `$line` on mainnet, read from $endpoint, and records the attempt with nothing sent",
    async ({ line, endpoint, events }) => {
      env.connection = { rpcEndpoint: endpoint };
      vi.mocked(PgConnection.getCluster).mockResolvedValue("mainnet");

      const result = run(line);

      await expect(result).rejects.toBeInstanceOf(TerminalLineError);
      await expect(result).rejects.toThrow(MAINNET_IDL_BLOCKED);
      expect(PgConnection.getCluster).toHaveBeenCalledWith(endpoint);
      expect(tracked.events).toEqual(events);
      expectNothingSent();
    }
  );

  // A custom RPC that is down could be mainnet
  it("refuses an endpoint that does not say which network it serves, and records the attempt as rpc", async () => {
    vi.mocked(PgConnection.getCluster).mockRejectedValue(
      new Error("429 Too Many Requests")
    );

    await expect(run("anchor idl upgrade")).rejects.toThrow(IDL_NETWORK_UNREAD);
    expect(tracked.events).toEqual(refusedUpload("devnet", "rpc"));
    expectNothingSent();
  });

  // A custom RPC's network read can outlast a network change the hold does not cover
  it("refuses when the endpoint changed between the network read and the send, and records the attempt as rpc on the endpoint it read", async () => {
    vi.mocked(PgConnection.getCluster).mockImplementation(async () => {
      env.connection = { rpcEndpoint: Endpoint.MAINNET_BETA };
      return "devnet";
    });

    const result = run("anchor idl init");

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(IDL_NETWORK_CHANGED);
    expect(tracked.events).toEqual(refusedUpload("devnet", "rpc"));
    expectNothingSent();
  });

  it.each([
    {
      label: "a failed send",
      send: async () => {
        throw new Error("blockhash not found");
      },
    },
    { label: "a successful send", send: async () => undefined },
  ])(
    "holds the network from the network read until $label ends, then releases it",
    async ({ send }) => {
      const held: boolean[] = [];
      vi.mocked(PgConnection.getCluster).mockImplementation(async () => {
        held.push(PgGlobal.isIdlWriting);
        return "devnet";
      });
      slice.close.mockImplementation(async () => {
        held.push(PgGlobal.isIdlWriting);
        return send();
      });

      await run(`anchor idl close ${GIVEN_PROGRAM}`).catch(
        (error: unknown) => error
      );

      expect(held).toEqual([true, true]);
      expect(PgGlobal.isIdlWriting).toBe(false);
    }
  );

  it.each([
    `anchor idl close ${GIVEN_PROGRAM}`,
    `anchor idl fetch ${GIVEN_PROGRAM} --non-canonical`,
  ])(
    "asks the wallet question for `%s` before any request, when no wallet is connected",
    async (line) => {
      env.wallet = undefined;

      await expect(run(line)).rejects.toThrow(WALLET_QUESTION);
      expect(PgConnection.getCluster).not.toHaveBeenCalled();
      expect(slice.fetchPublishedIdl).not.toHaveBeenCalled();
      expectNoAttempt();
    }
  );

  it.each([
    {
      line: "anchor idl init",
      entry: slice.upload,
      message:
        "The program has no upgrade authority, so no wallet can upload its IDL.",
    },
    {
      line: `anchor idl fetch ${GIVEN_PROGRAM}`,
      entry: slice.fetchPublishedIdl,
      message: `Program ${GIVEN_PROGRAM} has no published IDL on the selected network.`,
    },
  ])(
    "prints the slice's refusal of `$line` as its own line, without Process error:",
    async ({ line, entry, message }) => {
      entry.mockRejectedValue(new IdlCommandRefusedError("not_found", message));

      const result = run(line);

      await expect(result).rejects.toBeInstanceOf(TerminalLineError);
      await expect(result).rejects.toThrow(message);
    }
  );

  // The slice's own entry, so each line is the one the user reads
  it.each([
    {
      label: "a project that holds no IDL",
      idl: undefined,
      line: "anchor idl init",
      message:
        "The project has no IDL to upload. Build the IDL on your own machine and load it with Upload IDL, or pass a project file with `--filepath <path>`.",
    },
    {
      label: "a file the project does not hold, which the line names",
      idl: PROJECT_IDL,
      line: "anchor idl init --filepath idl/none.json",
      message: "The project has no IDL file at idl/none.json.",
    },
    {
      label: "a file that holds no JSON",
      idl: PROJECT_IDL,
      line: "anchor idl upgrade --filepath idl/broken.json",
      message: "idl/broken.json is not valid JSON: ",
    },
    {
      label: "an Anchor 0.29 IDL file without a program id",
      idl: PROJECT_IDL,
      line: "anchor idl init --filepath idl/legacy.json",
      message: "The IDL in idl/legacy.json is not in the Anchor 0.30+ format.",
    },
  ])(
    "ends an upload of $label with the slice's line and no request",
    async ({ idl, line, message }) => {
      const actual = await vi.importActual<
        typeof import("@/features/program-idl")
      >("@/features/program-idl");
      slice.uploadProjectIdlWith.mockImplementation(
        actual.uploadProjectIdlWith
      );
      const fetch = vi.spyOn(globalThis, "fetch");
      env.idl = idl;

      const result = run(line);

      await expect(result).rejects.toBeInstanceOf(TerminalLineError);
      await expect(result).rejects.toThrow(message);
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("ends with one line, and starts no upload, when no program ID is given and the project has none", async () => {
    env.programId = undefined;

    const result = run("anchor idl init");

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(
      "The project has no program ID. Build the program first, or pass a program ID."
    );
    expectNoAttempt();
  });

  // The project's program id is not the program of another IDL file
  it("ends with one line that names the file, and starts no upload, when the IDL file holds no address and no program ID is given", async () => {
    const result = run("anchor idl init --filepath idl/no-address.json");

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(
      "The IDL in idl/no-address.json has no valid `address`. Pass a program ID."
    );
    expectNoAttempt();
  });

  it.each([
    {
      line: "anchor idl init",
      endpoint: "http://localhost:8899",
      output: "Skipping IDL initialization on localnet",
    },
    {
      line: "anchor idl upgrade",
      endpoint: "http://127.0.0.1:8899",
      output: "Skipping IDL upgrade on localnet",
    },
  ])(
    "skips `$line` on $endpoint with Anchor's line, no wallet question, and nothing sent",
    async ({ line, endpoint, output }) => {
      env.wallet = undefined;
      env.connection = { rpcEndpoint: endpoint };

      await run(line);

      expect(printed()).toEqual([[output]]);
      expect(PgTerminal.get).not.toHaveBeenCalled();
      expect(PgConnection.getCluster).not.toHaveBeenCalled();
      expectNoAttempt();
    }
  );

  // Anchor skips a local validator for `init` and `upgrade` only
  it("sends `close` on a local validator", async () => {
    env.connection = { rpcEndpoint: "http://localhost:8899" };
    vi.mocked(PgConnection.getCluster).mockResolvedValue("localnet");

    await run(`anchor idl close ${GIVEN_PROGRAM}`);

    expect(slice.close).toHaveBeenCalled();
  });

  it("prints the published IDL as it is for `fetch` on mainnet, with no wallet question", async () => {
    env.wallet = undefined;
    env.connection = { rpcEndpoint: "https://api.mainnet-beta.solana.com" };
    vi.mocked(PgConnection.getCluster).mockResolvedValue("mainnet");
    slice.fetchPublishedIdl.mockResolvedValue('{"address":"published"}');

    await run(`anchor idl fetch ${GIVEN_PROGRAM}`);

    expect(slice.fetchPublishedIdl).toHaveBeenCalledWith({
      programId: GIVEN_PROGRAM,
      authority: undefined,
      connection: env.connection,
    });
    expect(printed()).toEqual([['{"address":"published"}', { noColor: true }]]);
    expect(PgTerminal.get).not.toHaveBeenCalled();
  });

  it("reads the connected wallet's own account for `fetch --non-canonical`", async () => {
    slice.fetchPublishedIdl.mockResolvedValue("{}");

    await run(`anchor idl fetch ${GIVEN_PROGRAM} --non-canonical`);

    expect(slice.fetchPublishedIdl).toHaveBeenCalledWith({
      programId: GIVEN_PROGRAM,
      authority: WALLET_ADDRESS,
      connection: CONNECTION,
    });
  });

  it("writes the published IDL to the `--out` file of the project and prints the client's line in its place", async () => {
    slice.fetchPublishedIdl.mockResolvedValue('{"address":"published"}');

    await run(`anchor idl fetch ${GIVEN_PROGRAM} --out idl/fetched.json`);

    expect(applyFile.mock.calls).toEqual([
      ["idl/fetched.json", '{"address":"published"}'],
    ]);
    expect(printed()).toEqual([
      [
        `${PgTerminal.success(
          "[Success] "
        )}Metadata content saved to ${PgTerminal.bold("idl/fetched.json")}`,
      ],
    ]);
  });

  it("refuses to write the `--out` file when another project was opened during the fetch, and writes nothing", async () => {
    const openProject = vi
      .spyOn(PgExplorer, "currentWorkspaceId", "get")
      .mockReturnValue("first-project");
    slice.fetchPublishedIdl.mockImplementation(async () => {
      openProject.mockReturnValue("second-project");
      return '{"address":"published"}';
    });

    const result = run(
      `anchor idl fetch ${GIVEN_PROGRAM} --out idl/fetched.json`
    );

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(
      "Another project was opened while the IDL was fetched, so nothing was written to idl/fetched.json."
    );
    expect(applyFile).not.toHaveBeenCalled();
  });

  // The explorer reads a name without an extension as a folder
  it("refuses an `--out` name without an extension, and writes nothing", async () => {
    slice.fetchPublishedIdl.mockResolvedValue('{"address":"published"}');

    const result = run(`anchor idl fetch ${GIVEN_PROGRAM} --out idl`);

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(
      "`--out` takes a file name with an extension, and idl has none."
    );
    expect(applyFile).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "build",
      command: "anchor idl build",
      line: "anchor idl build -p counter --no-docs",
    },
    {
      name: "fetch-historical",
      command: "anchor idl fetch-historical",
      line: `anchor idl fetch-historical ${GIVEN_PROGRAM} --slot 5`,
    },
    {
      name: "convert",
      command: "anchor idl convert",
      line: `anchor idl convert idl/counter.json --to-legacy -p ${GIVEN_PROGRAM}`,
    },
    {
      name: "type",
      command: "anchor idl type",
      line: "anchor idl type idl/counter.json --out types/counter.ts",
    },
    // The group alone, which a group without a handler would answer with its usage
    {
      name: "legacy-idl",
      command: "anchor legacy-idl",
      line: "anchor legacy-idl",
    },
    {
      name: "legacy-idl",
      command: "anchor legacy-idl",
      line: `anchor legacy-idl close ${GIVEN_PROGRAM} --idl-address ${BUFFER}`,
    },
  ] as const)(
    "ends `$line` with the not-supported line and its one event, with no wallet question and nothing sent",
    async ({ name, command, line }) => {
      env.wallet = undefined;

      const result = run(line);

      await expect(result).rejects.toBeInstanceOf(TerminalLineError);
      await expect(result).rejects.toThrow(
        `The Playground terminal does not support \`${command}\` yet. Run it with Anchor's CLI on your own machine.`
      );
      expect(slice.trackUnsupportedIdlCommand.mock.calls).toEqual([
        [name, CONNECTION.rpcEndpoint],
      ]);
      expect(PgTerminal.get).not.toHaveBeenCalled();
      expectNothingSent();
    }
  );

  it.each([
    {
      line: `anchor idl fetch ${GIVEN_PROGRAM} --provider.cluster devnet`,
      message: "Unexpected option: `--provider.cluster`",
    },
    // Anchor gives `--non-canonical` to `init` alone
    {
      line: "anchor idl upgrade --non-canonical",
      message: "Unexpected option: `--non-canonical`",
    },
    {
      line: "anchor idl init not-an-address",
      message:
        "Failed to parse argument: `program_id`: expected a base58 address",
    },
    {
      line: "anchor idl init --priority-fee high",
      message:
        "Failed to parse option: `priority-fee`: expected a whole number of micro-lamports per compute unit",
    },
    {
      line: "anchor idl fetch --out idl/fetched.json",
      message: "Argument not specified: `program_id`",
    },
    {
      line: `anchor idl set-buffer-authority ${BUFFER}`,
      message: "Option not specified: `new-authority`",
    },
    {
      line: `anchor idl write-buffer ${GIVEN_PROGRAM}`,
      message: "Option not specified: `buffer`",
    },
  ])(
    "refuses `$line` before any wallet question or request",
    async ({ line, message }) => {
      env.wallet = undefined;

      await expect(run(line)).rejects.toThrow(message);
      expect(PgTerminal.get).not.toHaveBeenCalled();
      expect(PgConnection.getCluster).not.toHaveBeenCalled();
      expect(slice.fetchPublishedIdl).not.toHaveBeenCalled();
      expectNoAttempt();
    }
  );

  // The terminal's parser reads `--help` only right after the subcommand's name; clap reads it anywhere
  it.each([
    { name: "init", line: `anchor idl init ${GIVEN_PROGRAM} --help` },
    {
      name: "upgrade",
      line: "anchor idl upgrade --filepath idl/counter.json -h",
    },
    { name: "close", line: `anchor idl close ${GIVEN_PROGRAM} --help` },
    {
      name: "create-buffer",
      line: "anchor idl create-buffer --priority-fee 7 --help",
    },
    {
      name: "set-buffer-authority",
      line: `anchor idl set-buffer-authority ${BUFFER} -h`,
    },
    {
      name: "write-buffer",
      line: `anchor idl write-buffer --buffer ${BUFFER} --help`,
    },
    {
      name: "fetch",
      line: `anchor idl fetch ${GIVEN_PROGRAM} --non-canonical --help`,
    },
  ])(
    "prints the usage of `$name` for `$line`, with no wallet question and nothing sent",
    async ({ name, line }) => {
      env.wallet = undefined;
      await run(`anchor idl ${name} --help`);
      const [[usage]] = printed();
      vi.mocked(PgTerminal.println).mockClear();

      await run(line);

      expect(usage).toContain("Options:");
      expect(printed()).toEqual([[usage]]);
      expect(PgTerminal.get).not.toHaveBeenCalled();
      expect(PgConnection.getCluster).not.toHaveBeenCalled();
      expect(slice.fetchPublishedIdl).not.toHaveBeenCalled();
      expectNoAttempt();
    }
  );

  // The terminal answers a name that is no subcommand with its parent's usage
  it.each(["authority", "set-authority", "erase-authority", "set-buffer"])(
    "answers `anchor idl %s`, a name Anchor 1.1.2 removed, with the usage of `anchor idl`, no wallet question, and nothing sent",
    async (name) => {
      env.wallet = undefined;

      await run(`anchor idl ${name} ${GIVEN_PROGRAM}`);

      const [[usage]] = printed();
      expect(usage).toContain("Usage: anchor idl <COMMAND>");
      expect(PgTerminal.get).not.toHaveBeenCalled();
      expect(PgConnection.getCluster).not.toHaveBeenCalled();
      expectNoAttempt();
    }
  );

  it("lists Anchor 1.1.2's eleven subcommands for `anchor idl --help`, with no wallet question", async () => {
    env.wallet = undefined;

    await run("anchor idl --help");

    const [[help]] = printed();
    expect(help).toContain("Usage: anchor idl <COMMAND>");
    const listed: string[] = help.match(/^\t\S+/gm) ?? [];
    expect(listed.map((name) => name.trim()).sort()).toEqual([
      "build",
      "close",
      "convert",
      "create-buffer",
      "fetch",
      "fetch-historical",
      "init",
      "set-buffer-authority",
      "type",
      "upgrade",
      "write-buffer",
    ]);
    expect(PgTerminal.get).not.toHaveBeenCalled();
  });

  it.each(["--version", "-V"])(
    "prints the Anchor version of the build server for `anchor %s`, offline too",
    async (flag) => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      await run(`anchor ${flag}`);

      expect(printed()).toEqual([[`anchor-cli ${ANCHOR_VERSION}`]]);
    }
  );
});
