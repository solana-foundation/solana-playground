// The command, the program-idl slice and the Program Metadata client run as they are;
// `fetch` reaches LiteSVM, which runs the Program Metadata program, and the wallet is a test keypair.
import { type Address, address, lamports } from "@solana/kit";
import type {
  Keypair,
  TransactionConfirmationStrategy,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  AccountDiscriminator,
  findCanonicalPda,
  findNonCanonicalPda,
  getBufferDecoder,
  PROGRAM_METADATA_PROGRAM_ADDRESS,
} from "@solana-program/program-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildConnectionWith,
  Endpoint,
  getKnownCluster,
} from "@/entities/cluster";
import {
  keypairOf,
  pricesOf,
  PROGRAM,
} from "@/features/program-idl/model/__fixtures__/chain";
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

import { PgExplorer } from "../../utils";
import { PgCommandManager } from "../../utils/command";
import { PgTerminal } from "../../utils/terminal";
import { clusterOf } from "./__fixtures__/cluster";
import { anchor } from "./anchor";

const AUTHORITY = keypairOf(1);
const OTHER = keypairOf(3);
const NEW_AUTHORITY = keypairOf(4).publicKey.toBase58();
const UNDEPLOYED = keypairOf(5).publicKey.toBase58();

/** An Anchor 0.30+ IDL of {@link PROGRAM}, as `anchor build` writes one */
const idlText = (version: string, docs: string[]) =>
  `${JSON.stringify(
    {
      address: PROGRAM,
      metadata: { name: "counter", version, spec: "0.1.0" },
      docs,
      instructions: [],
    },
    undefined,
    2
  )}\n`;

/** Text zlib cannot shrink, so the IDL needs a buffer and more than one transaction */
const incompressible = (length: number) => {
  let seed = 7;
  let text = "";
  while (text.length < length) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    text += seed.toString(36);
  }
  return text.slice(0, length);
};

const FILES = new Map([
  ["idl/counter.json", idlText("0.1.0", [])],
  ["idl/counter-v2.json", idlText("0.2.0", ["Counts"])],
  ["idl/large.json", idlText("0.1.0", [incompressible(4000)])],
]);
const fileText = (path: string) => FILES.get(path) ?? "";

const env = vi.hoisted(() => ({
  connection: undefined as unknown, // What `PgConnection.current` answers
  wallet: undefined as unknown, // What `PgWallet.current` answers
}));

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
      // What `PgConnection.getCluster` reads for one of the Playground's own endpoints, which needs no request
      getCluster: async (endpoint: string) => getKnownCluster(endpoint),
    },
    // eslint-disable-next-line unicorn/no-null -- `PgProgramInfo` answers `null` for a project without an IDL or a program ID
    PgProgramInfo: { idl: null, getPkStr: () => null },
    PgWallet: {
      get current() {
        return env.wallet;
      },
    },
  };
});

/** An external wallet that signs with `keypair` and counts its approvals */
const walletOf = (keypair: Keypair) => ({
  isPg: false,
  publicKey: keypair.publicKey,
  signAllTransactions: vi.fn(async (txs: VersionedTransaction[]) => {
    for (const tx of txs) tx.sign([keypair]);
    return txs;
  }),
});

/** The connection the Playground builds for Devnet, which reads `fetch` at each request so the test cluster answers */
const devnetConnection = () => {
  const connection = buildConnectionWith((input, init) =>
    globalThis.fetch(input, init)
  )(Endpoint.DEVNET);
  // web3.js confirms over a WebSocket subscription, which the test cluster does not serve; it answers the status read
  vi.spyOn(connection, "confirmTransaction").mockImplementation(
    async (strategy: TransactionConfirmationStrategy | string) => {
      const { context, value } = await connection.getSignatureStatuses([
        typeof strategy === "string" ? strategy : strategy.signature,
      ]);
      // eslint-disable-next-line unicorn/no-null -- web3.js answers `null` for a transaction without an error
      return { context, value: { err: value[0]?.err ?? null } };
    }
  );
  return connection;
};

const run = (line: string) => PgCommandManager.execute(line.split(" "));

/** What the terminal printed, one entry for each `println` */
const printed = () => vi.mocked(PgTerminal.println).mock.calls;

const upload = (name: string) => ({
  name,
  params: { target: "metadata", cluster: "devnet" },
});
const command = (name: string, cmd: string) => ({
  name,
  params: { command: cmd, cluster: "devnet" },
});

describe("commands/anchor on a cluster", () => {
  let saved: typeof PgCommandManager.all;
  let tracked: ReturnType<typeof memoryProvider>;
  let cluster: ReturnType<typeof clusterOf>;
  let metadata: Address;

  /** Connects `keypair`'s wallet, funded, and returns it */
  const connect = (keypair: Keypair) => {
    cluster.svm.airdrop(
      address(keypair.publicKey.toBase58()),
      lamports(10_000_000_000n)
    );
    const wallet = walletOf(keypair);
    env.wallet = wallet;
    return wallet;
  };

  /** Runs `line` and returns the first text it printed */
  const printedBy = async (line: string) => {
    vi.mocked(PgTerminal.println).mockClear();
    await run(line);
    const [[text]] = printed();
    return text;
  };
  const fetchIdl = () => printedBy(`anchor idl fetch ${PROGRAM}`);

  /** The number of `sendTransaction` requests the cluster received */
  const sends = () => cluster.sent.length;

  beforeEach(async () => {
    saved = PgCommandManager.all;
    PgCommandManager.all = { anchor } as never;
    tracked = memoryProvider();
    initTelemetry({ providers: [tracked] });
    initLogger({ providers: [logMemoryProvider()] });
    // web3.js serialises through Node's `Buffer`, whose `Uint8Array` is not jsdom's; a browser has one realm
    vi.stubGlobal(
      "Uint8Array",
      Object.getPrototypeOf(Buffer.prototype).constructor
    );
    vi.spyOn(PgTerminal, "process").mockImplementation(async (cb) => cb());
    vi.spyOn(PgTerminal, "println").mockResolvedValue();
    vi.spyOn(PgExplorer, "getFileContent").mockImplementation((path) =>
      FILES.get(path)
    );

    cluster = clusterOf();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url, init) => new Response(cluster.respond(String(init?.body)))
    );
    await cluster.deploy(PROGRAM, AUTHORITY.publicKey.toBase58());
    env.connection = devnetConnection();
    [metadata] = await findCanonicalPda({ program: PROGRAM, seed: "idl" });
  });

  afterEach(() => {
    PgCommandManager.all = saved;
    resetTelemetry();
    resetLogger();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes the canonical metadata account with `init --filepath`, which `fetch` then prints as the file holds it", async () => {
    connect(AUTHORITY);

    await run("anchor idl init --filepath idl/counter.json");

    expect(printed()).toEqual([
      [
        `${PgTerminal.success(
          "IDL initialized."
        )} Program Metadata account: ${metadata}`,
      ],
    ]);
    expect(await fetchIdl()).toBe(fileText("idl/counter.json"));
    expect(tracked.events).toEqual([
      upload("idl_upload_started"),
      upload("idl_uploaded"),
      command("idl_command_started", "fetch"),
      command("idl_command_succeeded", "fetch"),
    ]);
  });

  it("replaces the IDL with `upgrade --filepath`, so `fetch` prints the new version", async () => {
    connect(AUTHORITY);
    await run("anchor idl init --filepath idl/counter.json");
    vi.mocked(PgTerminal.println).mockClear();

    await run("anchor idl upgrade --filepath idl/counter-v2.json");

    expect(printed()).toEqual([
      [
        `${PgTerminal.success(
          "IDL upgraded."
        )} Program Metadata account: ${metadata}`,
      ],
    ]);
    expect(await fetchIdl()).toBe(fileText("idl/counter-v2.json"));
  });

  it("writes the wallet's own account with `init --non-canonical` for a wallet that is not the upgrade authority, which `fetch --non-canonical` prints", async () => {
    connect(OTHER);

    await run(
      `anchor idl init ${PROGRAM} --non-canonical --filepath idl/counter.json`
    );

    expect(await printedBy(`anchor idl fetch ${PROGRAM} --non-canonical`)).toBe(
      fileText("idl/counter.json")
    );
    expect(cluster.svm.getAccount(metadata).exists).toBe(false);
  });

  it("asks the wallet once for every transaction of an upload that needs a buffer, and leaves no buffer", async () => {
    const wallet = connect(AUTHORITY);

    await run("anchor idl init --filepath idl/large.json");

    expect(wallet.signAllTransactions).toHaveBeenCalledTimes(1);
    const [[signed]] = wallet.signAllTransactions.mock.calls;
    expect(signed.length).toBeGreaterThan(1);
    expect(sends()).toBe(signed.length);
    expect(await fetchIdl()).toBe(fileText("idl/large.json"));
    expect(
      cluster.svm.getProgramAccounts(PROGRAM_METADATA_PROGRAM_ADDRESS)
    ).toHaveLength(1);
  });

  it("sends `--priority-fee` as the compute-unit price of every transaction", async () => {
    connect(AUTHORITY);

    await run("anchor idl init --filepath idl/large.json --priority-fee 7");

    expect(pricesOf(cluster.sent)).toEqual(cluster.sent.map(() => 7n));
  });

  it("writes the metadata account from a buffer with `create-buffer` and `write-buffer --close-buffer`, and closes the buffer", async () => {
    connect(AUTHORITY);
    await run("anchor idl create-buffer --filepath idl/counter.json");
    const [[created]] = printed();
    const [, buffer] = /Buffer account: (\w+)$/.exec(created) ?? [];

    await run(
      `anchor idl write-buffer ${PROGRAM} --buffer ${buffer} --close-buffer`
    );

    expect(await fetchIdl()).toBe(fileText("idl/counter.json"));
    expect(cluster.svm.getAccount(address(buffer)).exists).toBe(false);
    expect(tracked.events).toEqual([
      command("idl_command_started", "create-buffer"),
      command("idl_command_succeeded", "create-buffer"),
      command("idl_command_started", "write-buffer"),
      command("idl_command_succeeded", "write-buffer"),
      command("idl_command_started", "fetch"),
      command("idl_command_succeeded", "fetch"),
    ]);
  });

  it("hands a buffer to a new authority with `set-buffer-authority`", async () => {
    connect(AUTHORITY);
    await run("anchor idl create-buffer --filepath idl/counter.json");
    const [[created]] = printed();
    const [, buffer] = /Buffer account: (\w+)$/.exec(created) ?? [];

    await run(
      `anchor idl set-buffer-authority ${buffer} --new-authority ${NEW_AUTHORITY}`
    );

    const account = cluster.svm.getAccount(address(buffer));
    if (!account.exists) throw new Error("The buffer is gone");
    expect(getBufferDecoder().decode(account.data).authority).toEqual({
      __option: "Some",
      value: NEW_AUTHORITY,
    });
  });

  it("closes the metadata account with `close`, returns its rent to the wallet, and `fetch` then finds no IDL", async () => {
    connect(AUTHORITY);
    await run("anchor idl init --filepath idl/counter.json");
    const wallet = address(AUTHORITY.publicKey.toBase58());
    const before = cluster.svm.getBalance(wallet) ?? 0n;
    const account = cluster.svm.getAccount(metadata);
    const rent = account.exists ? account.lamports : 0n;
    tracked.events.length = 0;

    // A price of zero leaves the fee at one signature's
    await run(`anchor idl close ${PROGRAM} --priority-fee 0`);

    expect(cluster.svm.getAccount(metadata).exists).toBe(false);
    expect(cluster.svm.getBalance(wallet)).toBe(before + rent - 5000n);
    await expect(run(`anchor idl fetch ${PROGRAM}`)).rejects.toThrow(
      `Program ${PROGRAM} has no published IDL on the selected network.`
    );
    expect(tracked.events).toEqual([
      command("idl_command_started", "close"),
      command("idl_command_succeeded", "close"),
      command("idl_command_started", "fetch"),
      {
        name: "idl_command_failed",
        params: { command: "fetch", cluster: "devnet", reason: "not_found" },
      },
    ]);
  });

  it.each([
    {
      label: "a wallet that is not the upgrade authority",
      wallet: OTHER,
      line: "anchor idl upgrade --filepath idl/counter.json",
      message: `The program's upgrade authority is ${AUTHORITY.publicKey.toBase58()}. Connect that wallet to upload the IDL.`,
      reason: "authority",
    },
    {
      label: "a program that is not deployed",
      wallet: AUTHORITY,
      line: `anchor idl init ${UNDEPLOYED} --filepath idl/counter.json`,
      message: `Program ${UNDEPLOYED} is not deployed on the selected network.`,
      reason: "not_deployed",
    },
    {
      label: "`--non-canonical` from the upgrade authority",
      wallet: AUTHORITY,
      line: `anchor idl init ${PROGRAM} --non-canonical --filepath idl/counter.json`,
      message:
        "The connected wallet is the program's upgrade authority, so its IDL goes to the canonical account. Run the command without `--non-canonical`.",
      reason: "authority",
    },
  ])(
    "refuses an upload by $label with one line, and sends no transaction",
    async ({ wallet, line, message, reason }) => {
      const connected = connect(wallet);

      await expect(run(line)).rejects.toThrow(message);

      expect(connected.signAllTransactions).not.toHaveBeenCalled();
      expect(sends()).toBe(0);
      expect(tracked.events).toEqual([
        upload("idl_upload_started"),
        {
          name: "idl_upload_failed",
          params: { target: "metadata", cluster: "devnet", reason },
        },
      ]);
    }
  );

  it("prints the declined approval of an upload, sends nothing, and records it as rejected", async () => {
    const wallet = connect(AUTHORITY);
    wallet.signAllTransactions.mockRejectedValueOnce(
      new Error("User rejected the request.")
    );

    await expect(
      run("anchor idl init --filepath idl/large.json")
    ).rejects.toThrow(
      "The wallet did not approve the IDL upload, so nothing was sent."
    );

    expect(sends()).toBe(0);
    expect(
      cluster.svm.getProgramAccounts(PROGRAM_METADATA_PROGRAM_ADDRESS)
    ).toEqual([]);
    expect(tracked.events).toEqual([
      upload("idl_upload_started"),
      {
        name: "idl_upload_failed",
        params: { target: "metadata", cluster: "devnet", reason: "rejected" },
      },
    ]);
  });

  describe("after an upload the RPC failed once its first transaction landed", () => {
    let failure: unknown;

    // The first transaction turns the canonical account into a buffer; the RPC drops the second
    beforeEach(async () => {
      connect(AUTHORITY);
      cluster.dropSendAt(1);
      failure = await run("anchor idl init --filepath idl/large.json").catch(
        (error: unknown) => error
      );
      vi.mocked(PgTerminal.println).mockClear();
    });

    /** The lamports the canonical account holds */
    const heldAtMetadata = () => {
      const account = cluster.svm.getAccount(metadata);
      return account.exists ? account.lamports : 0n;
    };

    it("prints the failure, then the SOL the buffer holds and that `init` again finishes it, records unfinished, and leaves the canonical account a buffer", () => {
      expect(tracked.events).toEqual([
        upload("idl_upload_started"),
        {
          name: "idl_upload_failed",
          params: {
            target: "metadata",
            cluster: "devnet",
            reason: "unfinished",
          },
        },
      ]);
      const sol = Number(heldAtMetadata()) / 1e9;
      expect(failure).toBeInstanceOf(Error);
      const lines = (failure as Error).message.split("\n");
      expect(lines[0]).toMatch(/^Process error: .*\S/);
      expect(lines).toContain("Message: Node is behind. ");
      expect(lines.at(-1)).toBe(
        `An unfinished upload holds ${sol} SOL at ${metadata}. Run the same \`anchor idl init\` again to finish it.`
      );
      const account = cluster.svm.getAccount(metadata);
      expect(account.exists && account.data[0]).toBe(
        AccountDiscriminator.Buffer
      );
    });

    it("finishes the upload under one approval when `init` runs again, and leaves no buffer", async () => {
      const wallet = connect(AUTHORITY);

      await run("anchor idl init --filepath idl/large.json");

      expect(wallet.signAllTransactions).toHaveBeenCalledTimes(1);
      expect(await fetchIdl()).toBe(fileText("idl/large.json"));
      expect(
        cluster.svm
          .getProgramAccounts(PROGRAM_METADATA_PROGRAM_ADDRESS)
          .map((account) => [account.address, account.data[0]])
      ).toEqual([[metadata, AccountDiscriminator.Metadata]]);
    });

    it("finishes the upload with a shorter IDL than the buffer was made for, which `fetch` prints without the buffer's tail", async () => {
      connect(AUTHORITY);

      await run("anchor idl init --filepath idl/counter.json");

      expect(await fetchIdl()).toBe(fileText("idl/counter.json"));
    });

    it("finishes the upload with `create-buffer` and `write-buffer --buffer`, which `fetch` then prints", async () => {
      connect(AUTHORITY);
      await run("anchor idl create-buffer --filepath idl/counter.json");
      const [[created]] = printed();
      const [, buffer] = /Buffer account: (\w+)$/.exec(created) ?? [];

      await run(`anchor idl write-buffer ${PROGRAM} --buffer ${buffer}`);

      expect(await fetchIdl()).toBe(fileText("idl/counter.json"));
    });

    it("ends `fetch` with the no-published-IDL line and the unfinished-upload line, and prints no buffer bytes", async () => {
      await expect(run(`anchor idl fetch ${PROGRAM}`)).rejects.toThrow(
        `Program ${PROGRAM} has no published IDL on the selected network.\nAn upload of its IDL is unfinished`
      );
      expect(printed()).toEqual([]);
    });

    it("closes the buffer with `close` and returns its rent to the wallet", async () => {
      const wallet = address(AUTHORITY.publicKey.toBase58());
      const before = cluster.svm.getBalance(wallet) ?? 0n;
      const rent = heldAtMetadata();

      await run(`anchor idl close ${PROGRAM} --priority-fee 0`);

      expect(cluster.svm.getAccount(metadata).exists).toBe(false);
      expect(cluster.svm.getBalance(wallet)).toBe(before + rent - 5000n);
      expect(printed()).toEqual([
        [PgTerminal.success("Metadata account closed successfully.")],
      ]);
    });
  });

  it("ends an upload whose blockhash expired after its first transaction with the expiry line and the unfinished-upload line, and `init` again finishes it", async () => {
    connect(AUTHORITY);
    cluster.expireAt(1);

    const failure = await run(
      "anchor idl init --filepath idl/large.json"
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    const lines = (failure as Error).message.split("\n");
    expect(lines[0]).toBe(
      "The IDL upload expired before every transaction was confirmed. Run the same command again."
    );
    expect(lines.at(-1)).toMatch(
      // eslint-disable-next-line security/detect-non-literal-regexp -- the only value in it is a base58 address, which holds no regex syntax
      new RegExp(
        `^An unfinished upload holds [\\d.]+ SOL at ${metadata}\\. Run the same \`anchor idl init\` again to finish it\\.$`
      )
    );
    expect(tracked.events.at(-1)).toEqual({
      name: "idl_upload_failed",
      params: { target: "metadata", cluster: "devnet", reason: "unfinished" },
    });

    await run("anchor idl init --filepath idl/large.json");

    expect(await fetchIdl()).toBe(fileText("idl/large.json"));
  });

  it("tells a non-canonical upload that failed after its first transaction to run `anchor idl init --non-canonical` again", async () => {
    connect(OTHER);
    const [own] = await findNonCanonicalPda({
      program: PROGRAM,
      authority: address(OTHER.publicKey.toBase58()),
      seed: "idl",
    });
    cluster.dropSendAt(1);

    const failure = await run(
      `anchor idl init ${PROGRAM} --non-canonical --filepath idl/large.json`
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message.split("\n").at(-1)).toMatch(
      // eslint-disable-next-line security/detect-non-literal-regexp -- the only value in it is a base58 address, which holds no regex syntax
      new RegExp(
        `^An unfinished upload holds [\\d.]+ SOL at ${own}\\. Run the same \`anchor idl init --non-canonical\` again to finish it\\.$`
      )
    );
  });

  it("names the SOL and address of the buffer an `upgrade` created when a send after it fails, and that a rerun does not reuse it", async () => {
    connect(AUTHORITY);
    await run("anchor idl init --filepath idl/counter.json");
    // The first transaction of the upgrade creates its buffer; the RPC drops the second
    cluster.dropSendAt(sends() + 1);

    const failure = await run(
      "anchor idl upgrade --filepath idl/large.json"
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    const last = (failure as Error).message.split("\n").at(-1) ?? "";
    const [, sol, buffer] =
      /^A buffer the failed send created holds ([\d.]+) SOL at (\w+)\. Running the same `anchor idl upgrade` again works but does not reuse this buffer, whose SOL stays until it is closed outside the Playground\.$/.exec(
        last
      ) ?? [];
    const account = cluster.svm.getAccount(address(buffer));
    expect(account.exists && account.data[0]).toBe(AccountDiscriminator.Buffer);
    expect(account.exists && Number(account.lamports) / 1e9).toBe(Number(sol));
    expect(tracked.events.at(-1)).toEqual({
      name: "idl_upload_failed",
      params: { target: "metadata", cluster: "devnet", reason: "unfinished" },
    });
  });
});
