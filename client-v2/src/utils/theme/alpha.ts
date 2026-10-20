/**
 * How much of a colour shows through, for the three weights the removed themes
 * wrote as hex suffixes (`16`, `64`, `bb` of `ff`), kept so the panels look
 * the same.
 */
export const ALPHA = { low: "9%", medium: "39%", high: "73%" } as const;

export type AlphaLevel = keyof typeof ALPHA;

/**
 * A colour at a lower opacity. Works on any CSS colour, `var(--token)`
 * included, which appending a hex suffix never did.
 */
export const alpha = (color: string, level: AlphaLevel) =>
  `color-mix(in srgb, ${color} ${ALPHA[level]}, transparent)`;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/theme/alpha", () => {
    describe("alpha", () => {
      it.each([
        ["low", "9%"],
        ["medium", "39%"],
        ["high", "73%"],
      ] as const)("%s mixes %s of the colour", (level, percent) => {
        expect(alpha("var(--primary)", level)).toBe(
          `color-mix(in srgb, var(--primary) ${percent}, transparent)`
        );
      });

      it("nests, so a mixed colour can be mixed again", () => {
        expect(alpha(alpha("var(--primary)", "high"), "low")).toBe(
          "color-mix(in srgb, color-mix(in srgb, var(--primary) 73%, transparent) 9%, transparent)"
        );
      });
    });
  });
}
