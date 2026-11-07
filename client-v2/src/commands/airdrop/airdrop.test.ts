import { describe, expect, it, vi } from "vitest";

import { checkSignedIn } from "../../features/auth";
import { PgConnection } from "../../utils";
import { airdrop } from "./airdrop";
import { COULD_NOT_READ_NETWORK, NO_FAUCET } from "./no-faucet";

// Only what `airdrop.handle` reads before it asks the RPC for SOL
vi.mock("../../utils", () => ({
  PgCommon: {},
  PgConnection: {
    // eslint-disable-next-line unicorn/no-null -- `PgConnection.cluster` is `null` before the cluster is read
    cluster: null,
    getAirdropAmountOn: vi.fn(),
    readCluster: vi.fn(),
  },
  PgTerminal: { println: vi.fn(), info: (text: string) => text },
  PgTx: {},
  PgWallet: {},
  PgWeb3: {},
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
    await expect(runOn("mainnet-beta", null)).rejects.toThrow(NO_FAUCET);
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
});
