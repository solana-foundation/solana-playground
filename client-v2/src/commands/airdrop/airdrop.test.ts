import { beforeEach, describe, expect, it, vi } from "vitest";

import { NETWORK_UNREACHABLE } from "@/shared/lib/faucet-limit";

import { checkSignedIn } from "../../features/auth";
import { PgConnection, PgTerminal } from "../../utils";
import { airdrop } from "./airdrop";
import { COULD_NOT_READ_NETWORK, NO_FAUCET } from "./no-faucet";
import { isAirdropRefused, isNetworkUnreachable } from "./report";

const rpc = vi.hoisted(() => ({
  getBalance: vi.fn(),
  requestAirdrop: vi.fn(),
  confirm: vi.fn(),
  commitment: "confirmed",
  rpcEndpoint: "https://api.devnet.solana.com",
}));

// Only what `airdrop.handle` reads before it asks the RPC for SOL
vi.mock("../../utils", () => ({
  PgCommon: { sleep: vi.fn(async () => {}) },
  PgConnection: {
    current: rpc,
    // The cluster's native RPC: the mocked RPC stands for it too
    getAirdropConnection: (selected: unknown) => selected,
    // eslint-disable-next-line unicorn/no-null -- `PgConnection.cluster` is `null` before the cluster is read
    cluster: null,
    getAirdropAmountOn: vi.fn(),
    readCluster: vi.fn(),
  },
  PgTerminal: { println: vi.fn(), info: (text: string) => text },
  PgTx: { confirm: rpc.confirm },
  PgWallet: { current: { publicKey: { toBase58: () => "Wa11et" } } },
  PgWeb3: { solToLamports: (sol: number) => sol * 1e9, DEFAULT_MS_PER_SLOT: 0 },
}));

// Signed out: the session check throws, as the real one does
vi.mock("../../features/auth", () => ({
  checkSignedIn: vi.fn(() => {
    throw new Error("Sign in with GitHub to request devnet SOL.");
  }),
}));

/** The airdrop's pre-checks after the wallet's, run on `cluster` */
const checkOn = async (cluster: string | null) => {
  Object.defineProperty(PgConnection, "cluster", {
    value: cluster,
    configurable: true,
  });
  const checks = airdrop.preChecks as Array<() => Promise<void> | void>;
  for (const check of checks.slice(1)) await check();
};

const runOn = (
  cluster: string | null,
  amount: ReturnType<typeof PgConnection.getAirdropAmountOn>
) => {
  Object.defineProperty(PgConnection, "cluster", {
    value: cluster,
    configurable: true,
  });
  vi.mocked(PgConnection.getAirdropAmountOn).mockReturnValue(amount);
  if (!airdrop.handle) throw new Error("airdrop has no handler");
  return airdrop.handle({ args: {} } as never);
};

describe("airdrop", () => {
  it("says the network has no faucet on mainnet", async () => {
    // eslint-disable-next-line unicorn/no-null -- `PgConnection.cluster` and `getAirdropAmountOn()` are `null` before the cluster is read or where there is no faucet
    const failure = await runOn("mainnet-beta", null).catch((e: unknown) => e);
    expect((failure as Error).message).toBe(NO_FAUCET);
    // Failed before the airdrop started: not a refusal, so no faucet steps
    expect(isAirdropRefused(failure)).toBe(false);
  });

  it("waits while the cluster is the previous endpoint's", async () => {
    Object.defineProperty(PgConnection, "clusterIsStale", {
      value: true,
      configurable: true,
    });
    await expect(checkOn("localnet")).resolves.toBeUndefined();
    await expect(runOn("localnet", 100)).rejects.toThrow("still loading");
    Object.defineProperty(PgConnection, "clusterIsStale", {
      value: false,
      configurable: true,
    });
  });

  it("ends the wait when the selected endpoint's network cannot be read", async () => {
    Object.defineProperty(PgConnection, "clusterIsStale", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(PgConnection, "hasClusterReadFailed", {
      value: true,
      configurable: true,
    });
    vi.mocked(PgConnection.readCluster).mockRejectedValueOnce(
      new Error("fetch failed")
    );
    const run = runOn("devnet", 1);
    await expect(run).rejects.toThrow(COULD_NOT_READ_NETWORK);
    await expect(run).rejects.not.toThrow("still loading");
    expect(PgConnection.readCluster).toHaveBeenCalledTimes(1);
    Object.defineProperty(PgConnection, "clusterIsStale", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(PgConnection, "hasClusterReadFailed", {
      value: false,
      configurable: true,
    });
  });

  it("goes on when the network reads on the second try", async () => {
    Object.defineProperty(PgConnection, "hasClusterReadFailed", {
      value: true,
      configurable: true,
    });
    vi.mocked(PgConnection.readCluster).mockClear();
    vi.mocked(PgConnection.readCluster).mockResolvedValueOnce("localnet");
    // Past the read, the handler reaches the faucet check
    // eslint-disable-next-line unicorn/no-null -- `getAirdropAmountOn()` is `null` where there is no faucet
    await expect(runOn("localnet", null)).rejects.toThrow(NO_FAUCET);
    expect(PgConnection.readCluster).toHaveBeenCalledTimes(1);
    Object.defineProperty(PgConnection, "hasClusterReadFailed", {
      value: false,
      configurable: true,
    });
  });

  it("takes the faucet and the sign-in from the network the retry read", async () => {
    Object.defineProperty(PgConnection, "hasClusterReadFailed", {
      value: true,
      configurable: true,
    });
    vi.mocked(PgConnection.readCluster).mockResolvedValueOnce("devnet");

    // The derivable still says localnet; the retry read devnet, which gates
    await expect(runOn("localnet", 100)).rejects.toThrow("Sign in with GitHub");
    Object.defineProperty(PgConnection, "hasClusterReadFailed", {
      value: false,
      configurable: true,
    });
  });

  it("does not claim there is no faucet before the cluster is read", async () => {
    // eslint-disable-next-line unicorn/no-null -- `PgConnection.cluster` and `getAirdropAmountOn()` are `null` before the cluster is read or where there is no faucet
    const run = runOn(null, null);
    await expect(run).rejects.toThrow("still loading");
    await expect(run).rejects.not.toThrow(NO_FAUCET);
  });

  // The local faucet is the user's own validator (Localnet, Surfpool)
  it.each(["localnet", "playnet"])(
    "airdrops on %s without a sign-in",
    async (cluster) => {
      await expect(checkOn(cluster)).resolves.toBeUndefined();
      expect(checkSignedIn).not.toHaveBeenCalled();
    }
  );

  it.each(["devnet", "testnet"])("asks to sign in on %s", async (cluster) => {
    await expect(checkOn(cluster)).rejects.toThrow("Sign in with GitHub");
  });

  it("asks no sign-in before the cluster is read, so the handler can say it is loading", async () => {
    // eslint-disable-next-line unicorn/no-null -- `PgConnection.cluster` is `null` before the cluster is read
    await expect(checkOn(null)).resolves.toBeUndefined();
  });

  describe("when the airdrop brings no SOL", () => {
    const askDevnet = () => runOn("devnet", 5).catch((e: unknown) => e);
    beforeEach(() => {
      rpc.getBalance.mockReset().mockResolvedValue(0);
      rpc.requestAirdrop.mockReset().mockResolvedValue("sig-1");
      rpc.confirm.mockReset().mockResolvedValue({});
      vi.mocked(PgConnection.getAirdropAmountOn).mockReturnValue(5);
    });

    it("says the network is unreachable, not a faucet refusal, when the RPC cannot be reached", async () => {
      rpc.requestAirdrop.mockRejectedValue(new TypeError("Failed to fetch"));

      const failure = await askDevnet();

      expect((failure as Error).message).toBe(NETWORK_UNREACHABLE);
      expect(isNetworkUnreachable(failure)).toBe(true);
      expect(isAirdropRefused(failure)).toBe(false);
    });

    it("does not send an offline user to the web faucet when the balance read fails", async () => {
      rpc.getBalance.mockRejectedValue(new TypeError("fetch failed"));
      vi.mocked(PgTerminal.println).mockClear();

      const failure = await askDevnet();

      expect(isNetworkUnreachable(failure)).toBe(true);
      expect(isAirdropRefused(failure)).toBe(false);
      expect(vi.mocked(PgTerminal.println).mock.calls.join("\n")).not.toContain(
        "web faucet"
      );
    });

    it("keeps a balance read the RPC answered with an error out of the refusals", async () => {
      rpc.getBalance.mockRejectedValue(new Error("Internal error"));

      expect(isAirdropRefused(await askDevnet())).toBe(false);
    });

    it("still refuses when the faucet answered and sent no SOL", async () => {
      rpc.requestAirdrop.mockRejectedValue(new Error("429 Too Many Requests"));

      expect(isAirdropRefused(await askDevnet())).toBe(true);
    });

    it("refuses when the balance never moved", async () => {
      expect(isAirdropRefused(await askDevnet())).toBe(true);
    });
  });
});
