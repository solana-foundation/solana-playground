import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgCommand: { airdrop: { execute: vi.fn() } },
  PgConnection: {
    onDidChangeCluster: () => ({ dispose: () => undefined }),
    getAirdropAmount: () => 5,
  },
  PgTerminal: { println: vi.fn(), error: (text: string) => text },
}));
vi.mock("../../../features/auth", () => ({
  PgSession: { get: vi.fn(), signIn: vi.fn() },
}));

import { useAirdrop } from "./useAirdrop";
import { PgSession } from "../../../features/auth";
import { PgCommand } from "../../../utils";

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
});
