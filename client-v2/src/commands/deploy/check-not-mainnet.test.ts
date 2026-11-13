import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnknownClusterError } from "@/entities/cluster";

import { PgConnection, PgGlobal, TerminalLineError } from "../../utils";
import { checkNotMainnet } from "./check-not-mainnet";
import {
  DEPLOY_NETWORK_UNREAD,
  MAINNET_DEPLOY_BLOCKED,
  MainnetDeployRefusedError,
} from "./mainnet-block";

vi.mock("../../utils", async () => {
  const terminal = await import("../../utils/terminal");
  return {
    TerminalLineError: terminal.TerminalLineError,
    PgGlobal: { deployState: "ready" },
    PgConnection: {
      cluster: "devnet",
      current: { rpcEndpoint: "https://rpc.example.com" },
      getCluster: vi.fn(),
    },
  };
});

describe("checkNotMainnet", () => {
  beforeEach(() => {
    vi.mocked(PgConnection.getCluster).mockReset();
    PgGlobal.deployState = "ready";
  });

  // The same command pauses and resumes a run under way: a stalled custom RPC
  // must not hold a pause for the read's 15 s, and that run already passed
  // the check at its start and checks again before each send
  it.each(["loading", "paused"] as const)(
    "reads no network while a deploy is %s",
    async (state) => {
      PgGlobal.deployState = state;
      vi.mocked(PgConnection.getCluster).mockResolvedValue("mainnet");

      await expect(checkNotMainnet()).resolves.toBeUndefined();
      expect(PgConnection.getCluster).not.toHaveBeenCalled();
    }
  );

  // The cached cluster says devnet: the guard reads the endpoint itself, as
  // a network switch or a custom RPC with mainnet's genesis would need
  it("refuses when the endpoint resolves to mainnet", async () => {
    vi.mocked(PgConnection.getCluster).mockResolvedValue("mainnet");

    const check = checkNotMainnet();

    await expect(check).rejects.toBeInstanceOf(TerminalLineError);
    // The Deploy stage tells this class apart from a failed deploy
    await expect(check).rejects.toBeInstanceOf(MainnetDeployRefusedError);
    await expect(check).rejects.toThrow(MAINNET_DEPLOY_BLOCKED);
    expect(PgConnection.getCluster).toHaveBeenCalledWith(
      "https://rpc.example.com"
    );
  });

  it.each(["devnet", "testnet", "localnet"] as const)(
    "lets %s through",
    async (cluster) => {
      vi.mocked(PgConnection.getCluster).mockResolvedValue(cluster);
      await expect(checkNotMainnet()).resolves.toBeUndefined();
    }
  );

  // A network of its own is not mainnet
  it("lets a genesis hash no cluster names through", async () => {
    vi.mocked(PgConnection.getCluster).mockRejectedValueOnce(
      new UnknownClusterError("Own1111")
    );
    await expect(checkNotMainnet()).resolves.toBeUndefined();
  });

  // An endpoint that does not answer could be mainnet: nothing on a guess
  it("refuses an endpoint that does not say which network it is", async () => {
    vi.mocked(PgConnection.getCluster).mockRejectedValueOnce(
      new Error("429 Too Many Requests")
    );
    await expect(checkNotMainnet()).rejects.toThrow(DEPLOY_NETWORK_UNREAD);
  });

  it("refuses an endpoint that does not answer in 15 s", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(PgConnection.getCluster).mockReturnValueOnce(
        new Promise(() => {})
      );
      const check = checkNotMainnet();
      const settled = expect(check).rejects.toThrow(DEPLOY_NETWORK_UNREAD);
      await vi.advanceTimersByTimeAsync(15_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});
