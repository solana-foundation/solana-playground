import { beforeEach, describe, expect, it, vi } from "vitest";

// The utils barrel needs build-time globals the unit runner does not define.
// `batchChanges` and `executeInOrder` are replaced by the callback itself, so
// calling the effect's return value runs one pass.
const unmounted = vi.hoisted(() => new Error("The terminal is not open."));
vi.mock("../../utils", () => ({
  PgCommand: {
    airdrop: { execute: vi.fn() },
    setting: { name: "settings" },
  },
  PgCommon: {
    batchChanges: (cb: () => unknown) => cb,
    executeInOrder: (cb: () => unknown) => cb,
  },
  PgConnection: { cluster: "devnet", getAirdropAmount: () => 5 },
  PgSettings: { wallet: { automaticAirdrop: true } },
  PgTerminal: { println: vi.fn() },
  PgWallet: { balance: 0 },
  isTerminalUnmounted: (error: unknown) => error === unmounted,
}));
vi.mock("../../features/auth", () => ({
  PgSession: { get: () => ({ user: {} }) },
}));

import { automaticAirdrop } from "./automatic-airdrop";
import { PgCommand, PgConnection } from "../../utils";

const airdrop = vi.mocked(PgCommand.airdrop.execute);
const pass = automaticAirdrop() as unknown as () => Promise<void>;

describe("automaticAirdrop", () => {
  beforeEach(() => {
    airdrop.mockReset();
  });

  // Home mounts no terminal, so the airdrop cannot run there; that must not
  // turn it off for the rest of the session
  it("tries again once a terminal was missing", async () => {
    (PgConnection as { cluster: string }).cluster = "localnet";
    airdrop.mockRejectedValueOnce(unmounted);
    await pass();

    airdrop.mockResolvedValueOnce(undefined);
    await pass();

    expect(airdrop).toHaveBeenCalledTimes(2);
  });

  it("stops on a cluster whose airdrop failed", async () => {
    (PgConnection as { cluster: string }).cluster = "testnet";
    airdrop.mockRejectedValueOnce(new Error("rate limited"));
    await pass();
    await pass();

    expect(airdrop).toHaveBeenCalledTimes(1);
  });
});
