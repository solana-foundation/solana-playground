import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgCommand: { airdrop: { execute: vi.fn() } },
  PgConnection: {
    onDidChangeCluster: vi.fn(() => ({ dispose: () => undefined })),
    getAirdropAmount: vi.fn(() => 5),
  },
  PgTerminal: { println: vi.fn(), error: (text: string) => text },
}));
vi.mock("../../../features/auth", () => ({
  PgSession: { get: vi.fn(), signIn: vi.fn() },
}));

import { useAirdrop } from "./useAirdrop";
import { PgSession } from "../../../features/auth";
import { PgCommand, PgConnection } from "../../../utils";

/** The hook's faucet once the cluster changes to `cluster` */
const faucetOn = (
  cluster: string | null,
  amount: ReturnType<typeof PgConnection.getAirdropAmount>
) => {
  const { result } = renderHook(() => useAirdrop());
  const [onChange] = vi.mocked(PgConnection.onDidChangeCluster).mock.lastCall!;
  vi.mocked(PgConnection.getAirdropAmount).mockReturnValue(amount);
  act(() => (onChange as (c: string | null) => void)(cluster));
  return result.current.faucet;
};

describe("useAirdrop", () => {
  beforeEach(() => {
    vi.mocked(PgSession.get).mockReturnValue(null);
  });

  // The caller tells the user; printed to a folded console, or to none under
  // Home, the failure reached nobody
  it("rejects with a failed sign-in, and does not airdrop", async () => {
    const failure = new Error("popup blocked");
    vi.mocked(PgSession.signIn).mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useAirdrop());

    await expect(result.current.airdrop()).rejects.toBe(failure);

    expect(PgCommand.airdrop.execute).not.toHaveBeenCalled();
  });

  it("knows no faucet until the cluster is read", () => {
    expect(faucetOn(null, null)).toBe("unknown");
  });

  it("has a faucet on devnet", () => {
    expect(faucetOn("devnet", 5)).toBe("available");
  });

  it("has none on mainnet", () => {
    expect(faucetOn("mainnet-beta", null)).toBe("none");
  });
});
