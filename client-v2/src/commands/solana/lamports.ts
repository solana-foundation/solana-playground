/** Lamports in a SOL, as solana-sdk's `LAMPORTS_PER_SOL` */
const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Rust's `format!("{:.9}", lamports_to_sol(lamports))`: the SOL value with
 * nine decimals, computed on integers so no precision is lost.
 *
 * @param lamports the amount
 * @returns the amount in SOL with nine decimals
 */
export const formatSol = (lamports: bigint) => {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0");
  return `${whole}.${fraction}`;
};

/**
 * Rust's `format!("{}", lamports_to_sol(lamports))`: the shortest decimal
 * that reads back as the same `f64`, never with an exponent (JavaScript
 * switches to one below 1e-6). An amount of 9 decimals reads back as itself,
 * so the decimals the amount has, without trailing zeros, are that string.
 *
 * @param lamports the amount
 * @returns the amount in SOL
 */
export const displaySol = (lamports: bigint) =>
  formatSol(lamports).replace(/\.?0+$/, "");

/**
 * What the Solana CLI's `build_balance_message` prints for an amount in SOL:
 * nine decimals, trailing zeros and a dangling point trimmed, then " SOL".
 *
 * @param lamports the amount
 * @returns the balance as the buffers table shows it
 */
export const buildBalanceMessage = (lamports: bigint) =>
  `${displaySol(lamports)} SOL`;

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

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
}
