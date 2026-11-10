/** Readable Solana addresses for the Flow view's tests. Imported by tests only. */

import { type Address, isAddress } from "@solana/kit";

/** The longest base58 text that decodes to 32 bytes */
const MAX_ADDRESS_LENGTH = 44;

/** A valid address made of `prefix`, `1`s, and `suffix`; throws when none exists */
export const seededAddress = (prefix: string, suffix: string): Address => {
  for (
    let length = prefix.length + suffix.length;
    length <= MAX_ADDRESS_LENGTH;
    length++
  ) {
    const candidate = prefix.padEnd(length - suffix.length, "1") + suffix;
    if (isAddress(candidate)) return candidate;
  }
  throw new Error(
    `No address is "${prefix}…${suffix}": base58 has no 0, O, I or l, and an address has at most ${MAX_ADDRESS_LENGTH} characters`
  );
};

/** The deployed program */
export const PROGRAM_ID = seededAddress("Program", "Counter");

/** The wallet that pays for the deploy */
export const WALLET = seededAddress("Wa11et", "Payer");

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/stages/addresses.fixture", () => {
    it("pads between the prefix and the suffix into a valid address", () => {
      const result = seededAddress("Program", "Counter");

      expect(result).toMatch(/^Program1+Counter$/);
      expect(isAddress(result)).toBe(true);
    });

    it("throws for a seed that is not base58", () => {
      expect(() => seededAddress("l0", "")).toThrow('No address is "l0…"');
    });
  });
}
