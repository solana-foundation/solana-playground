/** `text` with every character a RegExp reads as syntax escaped, so the pattern matches it literally */
export const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/escape-reg-exp", () => {
    it("matches every syntax character literally", () => {
      const text = ".*+?^${}()|[]\\";
      // eslint-disable-next-line security/detect-non-literal-regexp -- the escaped probe is the case under test
      expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    });
  });
}
