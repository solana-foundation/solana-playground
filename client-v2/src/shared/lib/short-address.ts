/**
 * An address as the designers' copy writes it, the first and last four
 * characters: "7xKX…4fQa"
 */
export const shortAddress = (address: string) =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/short-address", () => {
    it("shortAddress keeps four characters at each end", () => {
      expect(shortAddress("7Hq5mZ3vN2pQ8rT4wY6xL1cB9dF0gJ5kS3aV7eU2Xk2P")).toBe(
        "7Hq5…Xk2P"
      );
    });
  });
}
