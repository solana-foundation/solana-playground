import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnknownClusterError } from "@/entities/cluster";

import {
  PgConnection,
  PgGlobal,
  PgPackage,
  PgSettings,
  TerminalLineError,
} from "../../utils";
import {
  IDL_NETWORK_CHANGED,
  IDL_NETWORK_UNREAD,
  MAINNET_IDL_BLOCKED,
} from "../deploy/mainnet-block";
import { anchor, isIdlWrite } from "./anchor";

const runAnchor = vi.fn();

vi.mock("../../utils", async () => {
  const terminal = await import("../../utils/terminal");
  return {
    TerminalLineError: terminal.TerminalLineError,
    PgGlobal: { isIdlWriting: false },
    PgConnection: {
      // The cached cluster: the refusal must not trust it
      cluster: "devnet",
      current: { rpcEndpoint: "https://cached.example.com" },
      getCluster: vi.fn(),
    },
    // The endpoint the WASM Anchor CLI sends to
    PgSettings: { connection: { endpoint: "https://rpc.example.com" } },
    PgPackage: { import: vi.fn() },
  };
});

type Handle = NonNullable<typeof anchor.handle>;

const run = (raw: string) => {
  if (!anchor.handle) throw new Error("`anchor` has no handler");
  return anchor.handle({ raw } as Parameters<Handle>[0]);
};

describe("isIdlWrite", () => {
  it.each([
    "anchor idl init",
    "anchor idl upgrade",
    "anchor idl write-buffer",
    "anchor idl set-buffer 11111111111111111111111111111111",
    "anchor idl close",
    "anchor idl set-authority -n 11111111111111111111111111111111",
    "anchor idl erase-authority",
    "  anchor   idl   init   Prog1111  ",
    // A subcommand a later CLI adds is refused until it is listed as a read
    "anchor idl create-buffer",
  ])("counts `%s` as a write", (raw) => {
    expect(isIdlWrite(raw)).toBe(true);
  });

  it.each([
    "anchor idl fetch",
    "anchor idl authority",
    "anchor idl",
    "anchor --help",
    "anchor idl init --help",
    "anchor idl upgrade -h",
    "anchor idl help init",
  ])("lets `%s` through as a read", (raw) => {
    expect(isIdlWrite(raw)).toBe(false);
  });
});

describe("anchor", () => {
  beforeEach(() => {
    PgSettings.connection.endpoint = "https://rpc.example.com";
    PgGlobal.isIdlWriting = false;
    vi.mocked(PgConnection.getCluster).mockReset();
    runAnchor.mockReset();
    vi.mocked(PgPackage.import).mockResolvedValue({ runAnchor } as never);
  });

  it("refuses an IDL write on mainnet-beta before the CLI loads", async () => {
    vi.mocked(PgConnection.getCluster).mockResolvedValue("mainnet-beta");

    const result = run("anchor idl init");

    await expect(result).rejects.toBeInstanceOf(TerminalLineError);
    await expect(result).rejects.toThrow(MAINNET_IDL_BLOCKED);
    expect(PgConnection.getCluster).toHaveBeenCalledWith(
      "https://rpc.example.com"
    );
    expect(PgPackage.import).not.toHaveBeenCalled();
    expect(runAnchor).not.toHaveBeenCalled();
  });

  // A custom RPC that is down could be mainnet: nothing on a guess
  it("refuses an IDL write when the endpoint does not say its network", async () => {
    vi.mocked(PgConnection.getCluster).mockRejectedValueOnce(
      new Error("429 Too Many Requests")
    );
    await expect(run("anchor idl upgrade")).rejects.toThrow(IDL_NETWORK_UNREAD);
    expect(runAnchor).not.toHaveBeenCalled();
  });

  it.each(["devnet", "testnet", "localnet"] as const)(
    "runs an IDL write on %s",
    async (cluster) => {
      vi.mocked(PgConnection.getCluster).mockResolvedValue(cluster);
      await run("anchor idl init");
      expect(runAnchor).toHaveBeenCalledWith("anchor idl init");
    }
  );

  // Surfpool and other networks of their own
  it("runs an IDL write on a network no cluster names", async () => {
    vi.mocked(PgConnection.getCluster).mockRejectedValueOnce(
      new UnknownClusterError("Own1111")
    );
    await run("anchor idl init");
    expect(runAnchor).toHaveBeenCalledWith("anchor idl init");
  });

  it("runs a read on mainnet-beta without reading the network", async () => {
    vi.mocked(PgConnection.getCluster).mockResolvedValue("mainnet-beta");
    await run("anchor idl fetch");
    expect(PgConnection.getCluster).not.toHaveBeenCalled();
    expect(runAnchor).toHaveBeenCalledWith("anchor idl fetch");
  });

  // The CLI's first load can outlast a switch to mainnet in Settings
  it("refuses an IDL write when the endpoint changed while the CLI loaded", async () => {
    vi.mocked(PgConnection.getCluster).mockResolvedValue("devnet");
    vi.mocked(PgPackage.import).mockImplementationOnce(async () => {
      PgSettings.connection.endpoint = "https://api.mainnet-beta.solana.com";
      return { runAnchor } as never;
    });

    await expect(run("anchor idl init")).rejects.toThrow(IDL_NETWORK_CHANGED);
    expect(runAnchor).not.toHaveBeenCalled();
  });

  // `idl init` writes after its create confirms, reading the endpoint again:
  // Settings must not move the network meanwhile (Greptile on PR 131)
  it("holds the network for the whole IDL write and releases it after", async () => {
    vi.mocked(PgConnection.getCluster).mockResolvedValue("devnet");
    const held: boolean[] = [];
    vi.mocked(PgConnection.getCluster).mockImplementationOnce(async () => {
      held.push(PgGlobal.isIdlWriting);
      return "devnet";
    });
    runAnchor.mockImplementationOnce(async () => {
      held.push(PgGlobal.isIdlWriting);
    });

    await run("anchor idl init");

    expect(held).toEqual([true, true]);
    expect(PgGlobal.isIdlWriting).toBe(false);
  });

  it("releases the network when an IDL write is refused or fails", async () => {
    vi.mocked(PgConnection.getCluster).mockResolvedValue("mainnet-beta");
    await expect(run("anchor idl init")).rejects.toThrow(MAINNET_IDL_BLOCKED);
    expect(PgGlobal.isIdlWriting).toBe(false);

    vi.mocked(PgConnection.getCluster).mockResolvedValue("devnet");
    runAnchor.mockRejectedValueOnce(new Error("blockhash not found"));
    await expect(run("anchor idl upgrade")).rejects.toThrow("blockhash");
    expect(PgGlobal.isIdlWriting).toBe(false);
  });

  it("does not hold the network for a read", async () => {
    runAnchor.mockImplementationOnce(async () => {
      expect(PgGlobal.isIdlWriting).toBe(false);
    });
    await run("anchor idl fetch");
    expect(runAnchor).toHaveBeenCalledOnce();
  });
});
