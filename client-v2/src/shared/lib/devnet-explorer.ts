/**
 * Solana Explorer links on devnet, whatever the settings pick. A tutorial
 * runs on devnet only, so its links never follow the explorer setting
 * (`useBlockExplorer`) or the current connection (`solana-explorer.ts`).
 */
export type ExplorerTarget =
  | { kind: "address"; value: string }
  | { kind: "tx"; value: string };

export const devnetExplorerUrl = (target: ExplorerTarget): string =>
  `https://explorer.solana.com/${target.kind}/${encodeURIComponent(
    target.value
  )}?cluster=devnet`;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/devnet-explorer", () => {
    it("links an address and a transaction on devnet", () => {
      expect(devnetExplorerUrl({ kind: "address", value: "Prog1111" })).toBe(
        "https://explorer.solana.com/address/Prog1111?cluster=devnet"
      );
      expect(devnetExplorerUrl({ kind: "tx", value: "5igSig" })).toBe(
        "https://explorer.solana.com/tx/5igSig?cluster=devnet"
      );
    });
  });
}
