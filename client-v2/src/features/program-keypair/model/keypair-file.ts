/** The name Playground gives an exported program keypair file */
export const KEYPAIR_FILE_NAME = "program-keypair.json";

/** Why a file was not taken as a keypair */
export type KeypairFileRefusal = "not_json" | "wrong_shape";

export type KeypairFileRead =
  | { ok: true; secretKey: Uint8Array }
  | { ok: false; reason: KeypairFileRefusal };

/** An ed25519 secret key as the Solana CLI stores it: seed and public key */
const SECRET_KEY_LENGTH = 64;

const isByte = (n: unknown) =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255;

/**
 * Reads a keypair file in the Solana CLI's format, a JSON array of the 64
 * secret-key bytes. Each entry must be a byte: `Uint8Array.from` would wrap a
 * 256 to 0 and yield a keypair that is not the one exported.
 */
export const parseKeypairFile = (text: string): KeypairFileRead => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== SECRET_KEY_LENGTH ||
    !parsed.every(isByte)
  ) {
    return { ok: false, reason: "wrong_shape" };
  }
  return { ok: true, secretKey: Uint8Array.from(parsed) };
};

/** The file's content for a secret key: what `solana-keygen` writes */
export const keypairFileContent = (secretKey: Uint8Array): number[] =>
  Array.from(secretKey);

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/program-keypair/model/keypair-file", () => {
    const bytes = Array.from({ length: 64 }, (_, i) => i * 3);

    it("reads the 64-number array solana-keygen writes", () => {
      const read = parseKeypairFile(JSON.stringify(bytes));
      expect(read.ok && Array.from(read.secretKey)).toEqual(bytes);
    });

    it("takes 0 and 255, the ends of a byte", () => {
      const ends = [0, 255].concat(bytes.slice(2));
      expect(parseKeypairFile(JSON.stringify(ends)).ok).toBe(true);
    });

    it("refuses text that is not JSON", () => {
      expect(parseKeypairFile("{")).toEqual({ ok: false, reason: "not_json" });
    });

    it.each([
      ["32 numbers", JSON.stringify(bytes.slice(0, 32))],
      ["65 numbers", JSON.stringify(bytes.concat([1]))],
      ["no numbers", "[]"],
      ["a null document", "null"],
      ["a 256", JSON.stringify(bytes.map((b, i) => (i === 5 ? 256 : b)))],
      ["a -1", JSON.stringify(bytes.map((b, i) => (i === 5 ? -1 : b)))],
      ["a 1.5", JSON.stringify(bytes.map((b, i) => (i === 5 ? 1.5 : b)))],
      ["a string", JSON.stringify(bytes.map((b, i) => (i === 5 ? "5" : b)))],
      ["an object", JSON.stringify({ secretKey: bytes })],
    ])("refuses JSON with %s", (_name, text) => {
      expect(parseKeypairFile(text)).toEqual({
        ok: false,
        reason: "wrong_shape",
      });
    });

    it("writes what it reads back", () => {
      const secretKey = Uint8Array.from(bytes);
      const read = parseKeypairFile(
        JSON.stringify(keypairFileContent(secretKey))
      );
      expect(read.ok && Array.from(read.secretKey)).toEqual(bytes);
    });
  });
}
