import { PgWeb3 } from "../web3";

/**
 * A chosen file that does not hold a keypair; its message is for the user, in
 * the words of the designers' Spec 12 ("Import error")
 */
export class KeypairFileError extends Error {
  /** @param cause what rejected the file, kept for debugging */
  constructor(cause?: unknown) {
    super(
      "This file isn't a Solana keypair. Pick a .json file saved from Playground or the Solana CLI.",
      { cause }
    );
    this.name = "KeypairFileError";
  }
}

/** Whether a parsed JSON value is one byte, 0 to 255 */
const isByte = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255;

/**
 * Read a keypair file's text, the format `solana-keygen` writes.
 *
 * @param text the file's content
 * @returns the keypair the file holds
 * @throws {KeypairFileError} for text that is not JSON, not an array of 64
 * bytes, or bytes that are not a keypair
 */
export const parseKeypairFile = (text: string): PgWeb3.Keypair => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new KeypairFileError(err);
  }
  // `Uint8Array.from` would wrap 256 to 0 and read "a" as 0, so a byte that
  // is not one would otherwise reach the key as a different byte
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every(isByte)) {
    throw new KeypairFileError();
  }
  try {
    // Checks that the second half is the first half's public key
    return PgWeb3.Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch (err) {
    throw new KeypairFileError(err);
  }
};

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("utils/wallet/keypair-file", () => {
    it("parseKeypairFile reads a keypair file", () => {
      const keypair = PgWeb3.Keypair.generate();
      const text = JSON.stringify(Array.from(keypair.secretKey));
      expect(parseKeypairFile(text).publicKey.equals(keypair.publicKey)).toBe(
        true
      );
    });

    it.each([
      ["text that is not JSON", "hello"],
      ["JSON that is not an array", '{"key":"value"}'],
      ["an array of the wrong length", "[1,2,3]"],
      ["64 bytes that are not a keypair", JSON.stringify(Array(64).fill(1))],
      ["64 entries that are not bytes", JSON.stringify(Array(64).fill(256))],
      ["64 entries that are not numbers", JSON.stringify(Array(64).fill("a"))],
    ])("parseKeypairFile rejects %s with a message for the user", (_, text) => {
      expect(() => parseKeypairFile(text)).toThrow(KeypairFileError);
      expect(() => parseKeypairFile(text)).toThrow(/isn't a Solana keypair/);
    });
  });
}
