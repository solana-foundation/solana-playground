/**
 * A key as six and six, `9hJqVk…FxCvBz`, so the learner checks one key by the
 * same ends wherever it shows (Almaz's prototype); a key no longer than the
 * two ends is shown whole
 */
export const shortKey = (key: string) =>
  key.length <= 13 ? key : `${key.slice(0, 6)}…${key.slice(-6)}`;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/short-key", () => {
    it("keeps six and six of a long key, and a short one whole", () => {
      expect(shortKey("9hJqVkLtTRvQW1sUn6c3vXbF8pZkM2yHdA4eGqWxCvB")).toBe(
        "9hJqVk…qWxCvB"
      );
      expect(shortKey("1234567890123")).toBe("1234567890123");
      expect(shortKey("12345678901234")).toBe("123456…901234");
    });
  });
}
