import { beforeEach, describe, expect, it, vi } from "vitest";

import { NETWORK_UNREACHABLE } from "@/shared/lib/faucet-limit";

import { PgConnection } from "../../utils";
import { airdrop } from "./airdrop";
import { AirdropRefusedError, isAirdropRefused } from "./report";

const LAMPORTS_PER_SOL = 1_000_000_000;
const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const connection = {
  commitment: "confirmed",
  getBalance: vi.fn(),
  requestAirdrop: vi.fn(),
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
      return connection;
    },
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

describe("airdrop, once the faucet answers", () => {
  beforeEach(() => {
    printed.length = 0;
    connection.getBalance.mockReset();
    connection.requestAirdrop.mockReset();
    connection.requestAirdrop.mockImplementation(async () => `tx${++txCount}`);
    expect(PgConnection.cluster).toBe("devnet");
  });

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
});
