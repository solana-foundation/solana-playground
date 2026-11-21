import { describe, expect, it } from "vitest";

import { buildBalanceMessage, displaySol, formatSol } from "./lamports";

describe("commands/solana/lamports", () => {
  it.each([
    { lamports: 0n, fixed: "0.000000000", display: "0" },
    { lamports: 1n, fixed: "0.000000001", display: "0.000000001" },
    { lamports: 15119n, fixed: "0.000015119", display: "0.000015119" },
    { lamports: 244149880n, fixed: "0.244149880", display: "0.24414988" },
    {
      lamports: 6366203927475n,
      fixed: "6366.203927475",
      display: "6366.203927475",
    },
    { lamports: 1_000_000_000n, fixed: "1.000000000", display: "1" },
    { lamports: 10_000_000_000n, fixed: "10.000000000", display: "10" },
  ])("formats $lamports lamports", ({ lamports, fixed, display }) => {
    expect(formatSol(lamports)).toBe(fixed);
    expect(displaySol(lamports)).toBe(display);
  });

  it("builds the balance message of the buffers table", () => {
    expect(buildBalanceMessage(244149880n)).toBe("0.24414988 SOL");
    expect(buildBalanceMessage(0n)).toBe("0 SOL");
  });
});
