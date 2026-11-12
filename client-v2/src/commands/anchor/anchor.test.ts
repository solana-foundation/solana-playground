// A file of its own: `src/commands/` is a runtime module the UI move rule
// never touches, so its tests stay out of the modules (AGENTS.md). Every case
// runs through `PgCommandManager.execute`, which finds the subcommand, runs
// its pre-checks, and parses its arguments as the terminal does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IdlUploadRefusedError } from "@/features/program-idl";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

import { PgConnection, PgGlobal, PgProgramInfo } from "../../utils";
import { PgCommandManager } from "../../utils/command";
import { PgTerminal, TerminalLineError } from "../../utils/terminal";
import {
  IDL_NETWORK_CHANGED,
  IDL_NETWORK_UNREAD,
  MAINNET_IDL_BLOCKED,
} from "../deploy/mainnet-block";
import { anchor } from "./anchor";

const GIVEN_PROGRAM = "SysvarC1ock11111111111111111111111111111111";
const METADATA = "BPFLoaderUpgradeab1e11111111111111111111111";
const DEVNET = "https://api.devnet.solana.com";

const env = vi.hoisted(() => ({
  /** What `PgWallet.current` answers; `undefined` is no wallet connected */
  wallet: undefined as { isPg: boolean } | undefined,
  /** What `PgConnection.current` answers */
  connection: { rpcEndpoint: "" },
  /** The project's program id and the IDL it holds */
  programId: "SysvarRent111111111111111111111111111111111",
  idl: { address: "SysvarRent111111111111111111111111111111111" },
}));
const uploadProjectIdl = vi.hoisted(() => vi.fn());

vi.mock("@/features/program-idl", async () => {
  const actual = await vi.importActual<typeof import("@/features/program-idl")>(
    "@/features/program-idl"
  );
  return {
    IdlUploadRefusedError: actual.IdlUploadRefusedError,
    uploadProjectIdl,
  };
});

vi.mock("../../utils", async () => {
  const terminal = await import("../../utils/terminal");
  return {
    TerminalLineError: terminal.TerminalLineError,
    PgTerminal: terminal.PgTerminal,
    PgGlobal: { isIdlWriting: false },
    PgConnection: {
      get current() {
        return env.connection;
      },
      getCluster: vi.fn(),
    },
    PgProgramInfo: {
      get idl() {
        return env.idl;
      },
      getPkStr: () => env.programId,
    },
    PgWallet: {
      get current() {
        return env.wallet;
      },
    },
  };
});

const run = (line: string) => PgCommandManager.execute(line.split(" "));

describe("commands/anchor", () => {
  let saved: typeof PgCommandManager.all;

  beforeEach(() => {
    saved = PgCommandManager.all;
    PgCommandManager.all = { anchor } as never;
    // The terminal prints a failure and rethrows it; only the rethrow matters here
    vi.spyOn(PgTerminal, "process").mockImplementation(async (cb) => cb());
    vi.spyOn(PgTerminal, "println").mockResolvedValue();
    // The wallet question reaches the terminal through `get`, so a case that expects no question fails here
    vi.spyOn(PgTerminal, "get").mockRejectedValue(
      new Error("The command asked a wallet question")
    );

    // An external wallet: the program's upgrade authority need not be the Playground wallet
    env.wallet = { isPg: false };
    env.connection = { rpcEndpoint: DEVNET };
    PgGlobal.isIdlWriting = false;
    vi.mocked(PgConnection.getCluster).mockReset().mockResolvedValue("devnet");
    uploadProjectIdl
      .mockReset()
      .mockResolvedValue({ metadata: METADATA, action: "created" });
  });

  afterEach(() => {
    PgCommandManager.all = saved;
    resetTelemetry();
    vi.restoreAllMocks();
  });

  it.each([
    {
      label: "the project's program for `init` without an argument",
      line: "anchor idl init",
      programId: env.programId,
      action: "created",
    },
    {
      label: "the given program for `upgrade`",
      line: `anchor idl upgrade ${GIVEN_PROGRAM}`,
      programId: GIVEN_PROGRAM,
      action: "replaced",
    },
  ])(
    "uploads the project's IDL to $label and prints the account",
    async ({ line, programId, action }) => {
      uploadProjectIdl.mockResolvedValue({ metadata: METADATA, action });

      await run(line);

      expect(uploadProjectIdl).toHaveBeenCalledWith({
        idl: env.idl,
        programId,
        connection: env.connection,
        wallet: env.wallet,
      });
      expect(PgTerminal.println).toHaveBeenCalledWith(
        `${PgTerminal.success(
          `IDL ${action}.`
        )} Program Metadata account: ${METADATA}`
      );
    }
  );

  it("refuses a program ID that is not an address before any request", async () => {
    await expect(run("anchor idl init not-an-address")).rejects.toThrow(
      "Program ID must be a base58 address"
    );
    expect(PgConnection.getCluster).not.toHaveBeenCalled();
    expect(uploadProjectIdl).not.toHaveBeenCalled();
  });

  it("ends with one line, and starts no upload, when no program ID is given and the project has none", async () => {
    // eslint-disable-next-line unicorn/no-null -- `getPkStr` answers `null` for a project without a program ID
    vi.spyOn(PgProgramInfo, "getPkStr").mockReturnValue(null);

    const result = run("anchor idl init");

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(
      "The project has no program ID. Build the program first, or pass a program ID."
    );
    expect(uploadProjectIdl).not.toHaveBeenCalled();
  });

  it("refuses mainnet-beta, read from the endpoint it would send to, with nothing sent and no idl_upload_started", async () => {
    const tracked = memoryProvider();
    initTelemetry({ providers: [tracked] });
    // The slice's own entry, which records `idl_upload_started` as soon as it runs
    const actual = await vi.importActual<
      typeof import("@/features/program-idl")
    >("@/features/program-idl");
    uploadProjectIdl.mockImplementation(actual.uploadProjectIdl);
    const fetch = vi.spyOn(globalThis, "fetch");
    env.connection = { rpcEndpoint: "https://mainnet.custom-rpc.test" };
    vi.mocked(PgConnection.getCluster).mockResolvedValue("mainnet-beta");

    const result = run("anchor idl init");

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(MAINNET_IDL_BLOCKED);
    expect(PgConnection.getCluster).toHaveBeenCalledWith(
      "https://mainnet.custom-rpc.test"
    );
    expect(tracked.events).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  // A custom RPC that is down could be mainnet
  it("refuses an endpoint that does not say which network it serves", async () => {
    vi.mocked(PgConnection.getCluster).mockRejectedValue(
      new Error("429 Too Many Requests")
    );

    await expect(run("anchor idl upgrade")).rejects.toThrow(IDL_NETWORK_UNREAD);
    expect(uploadProjectIdl).not.toHaveBeenCalled();
  });

  // A custom RPC's network read can outlast a network change the hold does not cover
  it("refuses when the endpoint changed between the network read and the upload", async () => {
    vi.mocked(PgConnection.getCluster).mockImplementation(async () => {
      env.connection = { rpcEndpoint: "https://api.mainnet-beta.solana.com" };
      return "devnet";
    });

    const result = run("anchor idl init");

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(IDL_NETWORK_CHANGED);
    expect(uploadProjectIdl).not.toHaveBeenCalled();
  });

  it("holds the network from the network read until a failed upload ends, then releases it", async () => {
    const held: boolean[] = [];
    vi.mocked(PgConnection.getCluster).mockImplementation(async () => {
      held.push(PgGlobal.isIdlWriting);
      return "devnet";
    });
    uploadProjectIdl.mockImplementation(async () => {
      held.push(PgGlobal.isIdlWriting);
      throw new Error("blockhash not found");
    });

    await expect(run("anchor idl init")).rejects.toThrow("blockhash not found");

    expect(held).toEqual([true, true]);
    expect(PgGlobal.isIdlWriting).toBe(false);
  });

  it("prints an upload's refusal as its own line, without Process error:", async () => {
    const line =
      "The program has no upgrade authority, so no wallet can upload its IDL.";
    uploadProjectIdl.mockRejectedValue(
      new IdlUploadRefusedError("authority", line)
    );

    const result = run("anchor idl init");

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(line);
  });

  it.each([
    "authority",
    "close",
    "erase-authority",
    "fetch",
    "set-authority",
    "set-buffer",
    "write-buffer",
  ])(
    "ends `anchor idl %s` with the not-supported line, no wallet question, and no request",
    async (name) => {
      env.wallet = undefined;

      const result = run(`anchor idl ${name} ${GIVEN_PROGRAM}`);

      await expect(result).rejects.toBeInstanceOf(TerminalLineError);
      await expect(result).rejects.toThrow(
        `\`anchor idl ${name}\` is not supported in the Playground terminal. Run Anchor's CLI on your own machine.`
      );
      expect(PgTerminal.get).not.toHaveBeenCalled();
      expect(PgConnection.getCluster).not.toHaveBeenCalled();
      expect(uploadProjectIdl).not.toHaveBeenCalled();
    }
  );

  it("lists init and upgrade for `anchor idl --help`, with no wallet question", async () => {
    env.wallet = undefined;

    await run("anchor idl --help");

    const [[help]] = vi.mocked(PgTerminal.println).mock.calls;
    expect(help).toContain("Usage: anchor idl <COMMAND>");
    expect(help).toMatch(/init\s+Write the project's IDL/);
    expect(help).toMatch(/upgrade\s+Replace the on-chain IDL/);
    expect(PgTerminal.get).not.toHaveBeenCalled();
  });
});
