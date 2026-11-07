import { beforeEach, describe, expect, it, vi } from "vitest";

import { PgConnection, TerminalLineError } from "../../utils";
import { checkNotMainnet } from "./check-not-mainnet";
import { MAINNET_DEPLOY_BLOCKED } from "./mainnet-block";

vi.mock("../../utils", async () => {
  const { TerminalLineError } = await import("../../utils/terminal");
  return {
    TerminalLineError,
    PgConnection: {
      cluster: "devnet",
      current: { rpcEndpoint: "https://rpc.example.com" },
      getCluster: vi.fn(),
    },
  };
});

describe("checkNotMainnet", () => {
  beforeEach(() => vi.mocked(PgConnection.getCluster).mockReset());

  // The cached cluster says devnet: the guard reads the endpoint itself, as
  // a network switch or a custom RPC with mainnet's genesis would need
  it("refuses when the endpoint resolves to mainnet-beta", async () => {
    vi.mocked(PgConnection.getCluster).mockResolvedValue("mainnet-beta");

    const check = checkNotMainnet();

    await expect(check).rejects.toBeInstanceOf(TerminalLineError);
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

  // An endpoint that cannot be read is not refused on a guess: the deploy's
  // own reads fail before any transaction
  it("lets an unreadable endpoint through", async () => {
    vi.mocked(PgConnection.getCluster).mockRejectedValueOnce(new Error("down"));
    await expect(checkNotMainnet()).resolves.toBeUndefined();
  });
});
