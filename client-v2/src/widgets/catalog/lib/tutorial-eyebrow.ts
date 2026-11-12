import type { TutorialData } from "@/utils";

/**
 * The word over a tutorial card's name in a level's group: the level is the
 * heading there, so the framework alone.
 */
export const groupedEyebrow = (t: Pick<TutorialData, "framework">): string =>
  t.framework ?? "";

/**
 * The word over a tutorial card's name in a flat list: the level and the
 * framework. A missing framework drops with its separator.
 */
export const flatEyebrow = (
  t: Pick<TutorialData, "level" | "framework">
): string => [t.level, t.framework].filter(Boolean).join(" · ");

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/catalog/lib/tutorial-eyebrow", () => {
    const anchor = { level: "Beginner" as const, framework: "Anchor" as const };

    it("names the framework alone in a level's group", () => {
      expect(groupedEyebrow(anchor)).toBe("Anchor");
    });

    it("names the level and the framework in a flat list", () => {
      expect(flatEyebrow(anchor)).toBe("Beginner · Anchor");
    });

    it("drops a missing framework with its separator", () => {
      const native = { level: "Beginner" as const, framework: undefined };
      expect(flatEyebrow(native)).toBe("Beginner");
      expect(groupedEyebrow(native)).toBe("");
    });
  });
}
