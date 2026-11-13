import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NETWORK_UNREACHABLE } from "@/shared/lib/faucet-limit";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TEST_ENDPOINT } from "@/test-utils/endpoints.mjs";

import { PgConnection, PgTx } from "../../utils";
import { TerminalLineError } from "../../utils/terminal/line-error";
import { airdrop } from "./airdrop";
import { forgetFaucetClosed, isFaucetKnownClosed } from "./closed-faucet";
import { AirdropRefusedError, isAirdropRefused } from "./report";
import { withAirdropVia } from "./via";

const LAMPORTS_PER_SOL = 1_000_000_000;
const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

/** The cluster's native RPC, which airdrops go through */
const connection = {
  commitment: "confirmed",
  rpcEndpoint: TEST_ENDPOINT.DEVNET,
  getBalance: vi.fn(),
  requestAirdrop: vi.fn(),
};
/** The selected connection, a platform RPC that refuses airdrops as Helius does */
const platform = {
  commitment: "confirmed",
  getBalance: vi.fn(async () => 0),
  requestAirdrop: vi.fn(async () => {
    throw new Error("500 : internal error: please contact Helius support");
  }),
};
const printed: string[] = [];

// What `airdrop.handle` reads on a cluster that has a faucet, past the sign-in
vi.mock("../../utils", () => ({
  PgCommon: { sleep: vi.fn(async () => {}) },
  PgConnection: {
    cluster: "devnet",
    clusterIsStale: false,
    hasClusterReadFailed: false,
    getAirdropAmountOn: vi.fn(() => 5),
    get current() {
      return platform;
    },
    getAirdropConnection: vi.fn((selected: unknown) =>
      selected === platform ? connection : selected
    ),
  },
  PgTerminal: {
    println: vi.fn((line: string) => printed.push(line)),
    info: (text: string) => text,
    success: (text: string) => text,
  },
  // eslint-disable-next-line unicorn/no-null -- a confirmed transaction's `err` is `null`, as web3.js returns it
  PgTx: { confirm: vi.fn(async () => ({ err: null })) },
  PgWallet: { current: { publicKey: { toBase58: () => WALLET } } },
  PgWeb3: {
    solToLamports: (sol: number) => sol * 1_000_000_000,
    DEFAULT_MS_PER_SLOT: 400,
  },
}));

vi.mock("../../features/auth", () => ({ checkSignedIn: vi.fn() }));

let txCount = 0;
const run = () => {
  if (!airdrop.handle) throw new Error("airdrop has no handler");
  return airdrop.handle({ args: {} } as never);
};

let sent: ReturnType<typeof memoryProvider>;

describe("airdrop, once the faucet answers", () => {
  beforeEach(() => {
    sent = memoryProvider();
    initTelemetry({ providers: [sent] });
    printed.length = 0;
    connection.getBalance.mockReset();
    connection.requestAirdrop.mockReset();
    connection.requestAirdrop.mockImplementation(async () => `tx${++txCount}`);
    expect(PgConnection.cluster).toBe("devnet");
  });

  afterEach(() => resetTelemetry());

  it("says what arrived, not what was asked for", async () => {
    connection.getBalance
      .mockResolvedValueOnce(8.923 * LAMPORTS_PER_SOL)
      .mockResolvedValueOnce(9.923 * LAMPORTS_PER_SOL);

    await run();

    expect(printed).toContain("Airdropping 5 SOL...");
    expect(printed.at(-1)).toBe(
      "Airdrop successful: received 1 SOL of the 5 SOL requested."
    );
  });

  it("requests, confirms and reads the balances through the cluster's native RPC", async () => {
    connection.getBalance
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(5 * LAMPORTS_PER_SOL);

    await run();

    expect(PgConnection.getAirdropConnection).toHaveBeenCalledWith(platform);
    expect(connection.requestAirdrop).toHaveBeenCalledOnce();
    expect(PgTx.confirm).toHaveBeenLastCalledWith(expect.any(String), {
      connection,
    });
    expect(connection.getBalance).toHaveBeenCalledTimes(2);
    expect(platform.requestAirdrop).not.toHaveBeenCalled();
    expect(platform.getBalance).not.toHaveBeenCalled();
  });

  it("links the web faucet when the RPC rate-limits, and still fails", async () => {
    connection.getBalance.mockResolvedValue(0);
    connection.requestAirdrop.mockRejectedValueOnce(
      new Error("429 Too Many Requests: Too many airdrop requests.")
    );

    await expect(run()).rejects.toThrow("429");

    expect(printed.at(-1)).toContain(
      `https://faucet.solana.com/?walletAddress=${WALLET}&amount=5&cluster=devnet`
    );
  });

  it("links the web faucet when the balance read is the one rate-limited", async () => {
    connection.getBalance.mockRejectedValueOnce(
      new Error("429 Too Many Requests: rate limited")
    );

    await expect(run()).rejects.toThrow("429");

    expect(connection.requestAirdrop).not.toHaveBeenCalled();
    expect(printed.at(-1)).toContain("https://faucet.solana.com/?");
  });

  it("links the web faucet when a balance read after the airdrop is rate-limited", async () => {
    connection.getBalance
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error("429 Too Many Requests: rate limited"));

    await expect(run()).rejects.toThrow("429");

    expect(connection.requestAirdrop).toHaveBeenCalledOnce();
    expect(printed.at(-1)).toContain("https://faucet.solana.com/?");
  });

  it("reads the balance again while it is stale, and names what arrived", async () => {
    connection.getBalance
      .mockResolvedValueOnce(2 * LAMPORTS_PER_SOL)
      .mockResolvedValueOnce(2 * LAMPORTS_PER_SOL)
      .mockResolvedValueOnce(7 * LAMPORTS_PER_SOL);

    await run();

    expect(connection.getBalance).toHaveBeenCalledTimes(3);
    expect(printed.at(-1)).toBe("Airdrop successful: received 5 SOL.");
  });

  it("links the web faucet when the balance never moves, and still fails", async () => {
    connection.getBalance.mockResolvedValue(2 * LAMPORTS_PER_SOL);

    const failure = await run().catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(AirdropRefusedError);
    expect((failure as Error).message).toBe("Balance did not change");
    expect(printed.at(-1)).toMatch(
      /^Airdrop refused: the devnet faucet did not send SOL\./
    );
    expect(sent.events).toEqual([]);
  });

  it("links the web faucet for any other refusal, and keeps its message", async () => {
    connection.getBalance.mockResolvedValue(0);
    connection.requestAirdrop.mockRejectedValueOnce(
      new Error("Internal error")
    );

    const failure = await run().catch((e: unknown) => e);

    expect(isAirdropRefused(failure)).toBe(true);
    expect((failure as Error).message).toBe("Internal error");
    expect(printed.at(-1)).toContain(
      `https://faucet.solana.com/?walletAddress=${WALLET}&amount=5&cluster=devnet`
    );
    expect(printed.at(-1)).toContain("1. Open the web faucet");
  });

  it("adds no web faucet to a local validator that cannot be reached, and says so", async () => {
    const utils = await import("../../utils");
    const conn = utils.PgConnection as { cluster: string };
    conn.cluster = "localnet";
    try {
      connection.getBalance.mockResolvedValue(0);
      connection.requestAirdrop.mockRejectedValueOnce(
        new Error("fetch failed")
      );

      const failure = await run().catch((e: unknown) => e);

      expect(isAirdropRefused(failure)).toBe(false);
      expect((failure as Error).message).toBe(NETWORK_UNREACHABLE);
      expect(printed).toEqual(["Airdropping 5 SOL..."]);
    } finally {
      conn.cluster = "devnet";
    }
  });

  describe("on a closed faucet", () => {
    const CLOSED = `410 Gone: {"jsonrpc":"2.0","error":{"code": 410, "message":"The RPC faucet is closed on this cluster. Request test SOL at https://faucet.solana.com"}, "id": "1"}`;
    const LINE = `The devnet RPC faucet is closed. Request test SOL at https://faucet.solana.com/?walletAddress=${WALLET}&cluster=devnet`;

    beforeEach(() => {
      connection.getBalance.mockResolvedValue(0);
    });
    afterEach(() => forgetFaucetClosed(connection.rpcEndpoint));

    it("ends with one line to the web faucet, not the RPC's JSON", async () => {
      connection.requestAirdrop.mockRejectedValueOnce(new Error(CLOSED));

      const failure = await run().catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(TerminalLineError);
      // A refusal too: the chip and the menu show the way round for it
      expect(isAirdropRefused(failure)).toBe(true);
      expect((failure as Error).message).toBe(LINE);
      expect(printed).toEqual(["Airdropping 5 SOL..."]);
      expect(isFaucetKnownClosed(connection.rpcEndpoint)).toBe(true);
    });

    it("reads a 410 from a balance read as that failure, not a closed faucet", async () => {
      connection.getBalance.mockRejectedValueOnce(new Error(CLOSED));

      await expect(run()).rejects.toThrow(CLOSED);

      expect(isFaucetKnownClosed(connection.rpcEndpoint)).toBe(false);
    });

    it("still asks the faucet when the command runs again", async () => {
      connection.requestAirdrop.mockRejectedValueOnce(new Error(CLOSED));
      await expect(run()).rejects.toThrow(LINE);
      connection.getBalance
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(5 * LAMPORTS_PER_SOL);

      await run();

      expect(connection.requestAirdrop).toHaveBeenCalledTimes(2);
      // The faucet sent SOL: it reopened
      expect(isFaucetKnownClosed(connection.rpcEndpoint)).toBe(false);
    });
  });

  describe("fund_airdropped", () => {
    it("counts an airdrop that arrived as the terminal's, on the cluster it funded", async () => {
      connection.getBalance
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(5 * LAMPORTS_PER_SOL);

      await run();

      expect(sent.events).toEqual([
        {
          name: "fund_airdropped",
          params: { via: "terminal", cluster: "devnet" },
          scope: undefined,
        },
      ]);
    });

    it("names the caller that wrapped the run", async () => {
      connection.getBalance
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(5 * LAMPORTS_PER_SOL);

      await withAirdropVia(run, "deploy");

      expect(sent.events.map((event) => event.params)).toEqual([
        { via: "deploy", cluster: "devnet" },
      ]);
    });

    it("counts nothing when the airdrop fails", async () => {
      connection.getBalance.mockResolvedValue(0);
      connection.requestAirdrop.mockRejectedValueOnce(
        new Error("429 Too Many Requests: rate limited")
      );

      await expect(run()).rejects.toThrow("429");

      expect(sent.events).toEqual([]);
    });

    it("counts nothing when the airdrop transaction fails", async () => {
      connection.getBalance.mockResolvedValue(0);
      vi.mocked(PgTx.confirm).mockResolvedValueOnce({
        err: "InstructionError",
      } as never);

      await expect(run()).rejects.toThrow("Airdrop transaction failed");

      expect(sent.events).toEqual([]);
    });
  });
});
