/**
 * Solana Explorer on devnet, where every tutorial runs. `tutorial-runs` asks
 * every Explorer link to open the devnet cluster in a new tab, whatever block
 * explorer the settings name.
 */
const EXPLORER = "https://explorer.solana.com";

export const explorerTx = (signature: string) =>
  `${EXPLORER}/tx/${signature}?cluster=devnet`;

export const explorerAddress = (address: string) =>
  `${EXPLORER}/address/${address}?cluster=devnet`;

/** A key short enough for a row: its first and last four characters */
export const shortKey = (key: string) =>
  key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;

/** Lamports as devnet SOL, with no trailing zeros: 5000 is "0.000005" */
export const solOf = (lamports: number) =>
  (lamports / 1_000_000_000).toFixed(9).replace(/\.?0+$/, "");

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-conversation/model/explorer", () => {
    it("links a transaction and an address on devnet", () => {
      expect(explorerTx("5ig")).toBe(
        "https://explorer.solana.com/tx/5ig?cluster=devnet"
      );
      expect(explorerAddress("Wa11et")).toBe(
        "https://explorer.solana.com/address/Wa11et?cluster=devnet"
      );
    });

    it("shortens a long key and leaves a short one", () => {
      expect(shortKey("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T")).toBe(
        "4Nd1…DB4T"
      );
      expect(shortKey("short")).toBe("short");
    });

    it("reads lamports as SOL", () => {
      expect(solOf(5000)).toBe("0.000005");
      expect(solOf(1_500_000_000)).toBe("1.5");
      expect(solOf(0)).toBe("0");
    });
  });
}
