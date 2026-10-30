import { createLogger } from "@/shared/lib/logger";

const log = createLogger("deploy:backup");

const KEY = "flow.backupDismissed";
// `localStorage` is near its origin budget; a few addresses are all a
// browser ever holds, and the oldest answer is the one to forget
const MAX_ADDRESSES = 20;

const read = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((a): a is string => typeof a === "string")
      : [];
  } catch (e) {
    log.info("unreadable backup choices, starting empty", {
      context: { error: String(e) },
    });
    return [];
  }
};

/**
 * Answers this page view gave, kept beside the stored ones: an answer the
 * browser refused to store still holds until the page reloads
 */
const answeredHere = new Set<string>();

/** Whether the backup line was answered for the wallet at `address` */
export const isBackupAnswered = (address: string): boolean =>
  answeredHere.has(address) || read().includes(address);

/** Hide the backup line for the wallet at `address` in this browser */
export const answerBackup = (address: string): void => {
  answeredHere.add(address);
  const kept = [address, ...read().filter((a) => a !== address)].slice(
    0,
    MAX_ADDRESSES
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch (e) {
    // At the origin's quota the answer holds for this page view only, through
    // `answeredHere`; the line comes back after a reload
    log.error(e, { context: { what: "store the backup answer" } });
  }
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach } = import.meta.vitest;

  describe("features/deploy/model/backup", () => {
    beforeEach(() => {
      localStorage.clear();
      answeredHere.clear();
    });

    it("remembers an answer per wallet address", () => {
      answerBackup("A");
      expect(isBackupAnswered("A")).toBe(true);
      expect(isBackupAnswered("B")).toBe(false);
    });

    it("forgets the oldest stored address past the cap, after a reload", () => {
      for (let i = 0; i <= MAX_ADDRESSES; i++) answerBackup(`W${i}`);
      answeredHere.clear(); // what a reload leaves
      expect(isBackupAnswered("W0")).toBe(false);
      expect(isBackupAnswered(`W${MAX_ADDRESSES}`)).toBe(true);
    });

    it("survives storage that refuses the write", () => {
      const { vi } = import.meta.vitest!;
      const setItem = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new DOMException("full", "QuotaExceededError");
        });
      try {
        expect(() => answerBackup("refused")).not.toThrow();
        expect(isBackupAnswered("refused")).toBe(true);
      } finally {
        setItem.mockRestore();
      }
    });

    it("reads corrupted storage as no answers", () => {
      localStorage.setItem(KEY, "{not json");
      expect(isBackupAnswered("A")).toBe(false);
    });
  });
}
