import { describe, expect, it, vi } from "vitest";

import { PgConnection } from "../../utils";
import { airdrop } from "./airdrop";
import { NO_FAUCET } from "./no-faucet";

// Only what `airdrop.handle` reads before it asks the RPC for SOL
vi.mock("../../utils", () => ({
  PgCommon: {},
  PgConnection: { cluster: null, getAirdropAmount: vi.fn() },
  PgTerminal: { println: vi.fn(), info: (text: string) => text },
  PgTx: {},
  PgWallet: {},
  PgWeb3: {},
}));

const runOn = (
  cluster: string | null,
  amount: ReturnType<typeof PgConnection.getAirdropAmount>
) => {
  Object.defineProperty(PgConnection, "cluster", {
    value: cluster,
    configurable: true,
  });
  vi.mocked(PgConnection.getAirdropAmount).mockReturnValue(amount);
  if (!airdrop.handle) throw new Error("airdrop has no handler");
  return airdrop.handle({ args: {} } as never);
};

describe("airdrop", () => {
  it("says the network has no faucet on mainnet", async () => {
    await expect(runOn("mainnet-beta", null)).rejects.toThrow(NO_FAUCET);
  });

  it("does not claim there is no faucet before the cluster is read", async () => {
    const run = runOn(null, null);
    await expect(run).rejects.toThrow("still loading");
    await expect(run).rejects.not.toThrow(NO_FAUCET);
  });
});
