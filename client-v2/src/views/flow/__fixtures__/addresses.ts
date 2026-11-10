/** Solana addresses for the Flow view's tests. Imported by tests only. */

import {
  type Address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  isAddress,
} from "@solana/kit";

/** The longest address: every byte 255 */
const MAX_ADDRESS_LENGTH = getAddressDecoder().decode(
  new Uint8Array(getAddressEncoder().fixedSize).fill(255)
).length;

/** A valid address made of `prefix`, `1`s, and `suffix`; throws when none exists */
export const vanityAddress = (prefix: string, suffix: string): Address => {
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
export const PROGRAM_ID = vanityAddress("Program", "Counter");

/** The wallet that pays for the deploy */
export const WALLET = vanityAddress("Wa11et", "Payer");

/** A second wallet, for a test that needs one no earlier test has answered the backup question for */
export const FRESH_WALLET = vanityAddress("Fresh", "Wa11et");

/** The {@link PROGRAM_ID} PDA for `seed`, as `PublicKey.findProgramAddressSync` derives it */
export const seededAddress = async (seed: string): Promise<Address> => {
  const [address] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [seed],
  });
  return address;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/__fixtures__/addresses", () => {
    it("vanityAddress pads between the prefix and the suffix", () => {
      const result = vanityAddress("Program", "Counter");

      expect(result).toMatch(/^Program1+Counter$/);
      expect(isAddress(result)).toBe(true);
    });

    it("vanityAddress throws for a seed that is not base58", () => {
      expect(() => vanityAddress("l0", "")).toThrow('No address is "l0…"');
    });

    it("seededAddress derives one address per seed", async () => {
      const counter = await seededAddress("counter");

      expect(await seededAddress("counter")).toBe(counter);
      expect(await seededAddress("vault")).not.toBe(counter);
    });
  });
}
