/** Lamports in one SOL */
const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * SOL with two decimals, or more when two would read as zero, so a cost
 * of 0.002 SOL never shows as "0.00".
 */
export const formatSol = (lamports: number): string => {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol === 0 || sol >= 0.01) return sol.toFixed(2);
  return Number(sol.toPrecision(2)).toString();
};

/** An address or program id shortened in the middle: `7xKX…4fQa` */
export const shortKey = (key: string): string =>
  key.length <= 12 ? key : `${key.slice(0, 4)}…${key.slice(-4)}`;

/** The network's name in prose: "mainnet" for mainnet-beta */
export const networkName = (cluster: string | null): string =>
  cluster === "mainnet-beta" ? "mainnet" : cluster ?? "the network";

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/deploy/model/format", () => {
    it("formatSol keeps two decimals and never rounds a small cost to zero", () => {
      expect(formatSol(1_420_000_000)).toBe("1.42");
      expect(formatSol(0)).toBe("0.00");
      expect(formatSol(2_345_000)).toBe("0.0023");
    });

    it("shortKey keeps four characters at each end", () => {
      expect(shortKey("7xKXabcdefghijklmnop4fQa")).toBe("7xKX…4fQa");
      expect(shortKey("short")).toBe("short");
    });

    it("networkName says mainnet for mainnet-beta", () => {
      expect(networkName("mainnet-beta")).toBe("mainnet");
      expect(networkName("devnet")).toBe("devnet");
      expect(networkName(null)).toBe("the network");
    });
  });
}
