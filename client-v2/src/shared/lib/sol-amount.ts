/**
 * A SOL balance as the wallet chip, the account menu and the Deploy payer line
 * show it: up to four decimals, trailing zeros dropped, "0 SOL" when empty.
 * One copy, so the three cannot disagree about the same wallet.
 */
export const solAmount = (sol: number) => `${Number(sol.toFixed(4))} SOL`;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/sol-amount", () => {
    it("keeps up to four decimals and drops trailing zeros", () => {
      expect(solAmount(4.2)).toBe("4.2 SOL");
      expect(solAmount(1.234567)).toBe("1.2346 SOL");
    });

    it('reads "0 SOL" when empty', () => {
      expect(solAmount(0)).toBe("0 SOL");
    });
  });
}
