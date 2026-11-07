import type { RunResult } from "./progress";

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Whole SOL with at most two decimals: "2", "3.2", "0.45" */
const sol = (lamports: number) =>
  `${+(lamports / LAMPORTS_PER_SOL).toFixed(2)}`;

/**
 * What a landed airdrop card says it did (HOO-2677): the SOL it added, or the
 * balance it found enough, with no airdrop asked
 */
export const airdropRecord = (
  result: Extract<RunResult, { act: "airdrop"; ok: true }>
): string => {
  if (result.airdropped === 0) {
    return `Your wallet has ${sol(result.balance)} SOL`;
  }
  const added = `${sol(result.airdropped)} SOL`;
  return result.madeWallet
    ? `Made a wallet and added ${added}`
    : `Added ${added}`;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const SOL = LAMPORTS_PER_SOL;
  /** A landed airdrop's result: what it added and the balance after */
  const landedWith = (airdropped: number) => (balance: number) => ({
    act: "airdrop" as const,
    ok: true as const,
    seconds: 1,
    balance,
    airdropped,
  });
  const landed = (balance: number) => landedWith(balance)(balance);
  const found = landedWith(0);
  /** A landed airdrop whose press made the wallet first */
  const madeAndLanded = (balance: number) => ({
    act: "airdrop" as const,
    ok: true as const,
    seconds: 1,
    balance,
    airdropped: balance,
    madeWallet: true as const,
  });

  describe("features/tutorial-conversation/model/airdrop-record", () => {
    it("names the SOL an airdrop added", () => {
      expect(airdropRecord(landed(2 * SOL))).toBe("Added 2 SOL");
    });

    it("names the balance a funded wallet already had", () => {
      expect(airdropRecord(found(3.2 * SOL))).toBe("Your wallet has 3.2 SOL");
    });

    it("says the press made the wallet first", () => {
      expect(airdropRecord(madeAndLanded(2 * SOL))).toBe(
        "Made a wallet and added 2 SOL"
      );
    });
  });
}
