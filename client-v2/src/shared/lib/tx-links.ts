/**
 * Whether a transaction sent now is one its sender links to Explorer itself,
 * so the app-wide Explorer toast (`effects/tx`) would only repeat that link.
 * A tutorial act is the one such sender: its card carries the link.
 *
 * Kept apart from `PgTx` so a caller can mark its sends without importing the
 * wallet and settings stack (a test of such a caller would load the wasm
 * packages).
 */

/** How many senders that link their own transactions are running */
let depth = 0;

/**
 * Runs `fn` with every transaction sent meanwhile marked as linked by its
 * sender, and lifts the mark when `fn` settles, thrown or not. The mark is a
 * time window, not a tag on the transaction: a send from elsewhere while `fn`
 * runs (the Call panel, the wallet's Send) loses its toast too. Accepted: a
 * tagged send would thread a flag through the deploy commands the terminal
 * shares, and a send made during a running act is rare.
 */
export const linkingOwnTxs = async <T>(fn: () => Promise<T>): Promise<T> => {
  depth++;
  try {
    return await fn();
  } finally {
    depth--;
  }
};

/** Whether a sender that links its own transactions is running */
export const isTxLinkedBySender = (): boolean => depth > 0;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/tx-links", () => {
    it("marks sends only while the sender runs", async () => {
      let during = false;
      await linkingOwnTxs(async () => {
        during = isTxLinkedBySender();
      });
      expect(during).toBe(true);
      expect(isTxLinkedBySender()).toBe(false);
    });

    it("lifts the mark when the sender throws", async () => {
      await expect(
        linkingOwnTxs(async () => {
          throw new Error("broke");
        })
      ).rejects.toThrow("broke");
      expect(isTxLinkedBySender()).toBe(false);
    });

    it("keeps the mark until the last of two overlapping senders settles", async () => {
      let release = () => {};
      const outer = linkingOwnTxs(
        () => new Promise<void>((r) => (release = r))
      );
      await linkingOwnTxs(async () => {});
      expect(isTxLinkedBySender()).toBe(true);
      release();
      await outer;
      expect(isTxLinkedBySender()).toBe(false);
    });
  });
}
