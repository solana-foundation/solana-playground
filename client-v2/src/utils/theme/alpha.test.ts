import { describe, expect, it } from "vitest";

import { alpha } from "./alpha";

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
