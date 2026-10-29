import type { TutorialData } from "@/utils";

/**
 * The line under a tutorial card's description. In a level's group the level
 * is the heading, so the line names the framework and who wrote it; in a flat
 * list it names the level and the framework. A missing part drops with its
 * separator.
 */
export const tutorialCaption = (
  t: Pick<TutorialData, "level" | "framework" | "authors">,
  grouped: boolean
): string => {
  const author = t.authors[0] && `by ${t.authors[0].name}`;
  return (grouped ? [t.framework, author] : [t.level, t.framework])
    .filter(Boolean)
    .join(" · ");
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/catalog/lib/tutorial-caption", () => {
    const anchor = {
      level: "Beginner" as const,
      framework: "Anchor" as const,
      authors: [{ name: "acheron" }, { name: "someone" }],
    };

    it("names the framework and the first author in a level's group", () => {
      expect(tutorialCaption(anchor, true)).toBe("Anchor · by acheron");
    });

    it("names the level and the framework in a flat list", () => {
      expect(tutorialCaption(anchor, false)).toBe("Beginner · Anchor");
    });

    it("drops a missing framework with its separator", () => {
      const native = {
        level: "Beginner" as const,
        framework: undefined,
        authors: anchor.authors,
      };
      expect(tutorialCaption(native, false)).toBe("Beginner");
    });

    it("drops a missing author with its separator", () => {
      const anonymous = {
        level: "Beginner" as const,
        framework: "Anchor" as const,
        authors: [],
      };
      expect(tutorialCaption(anonymous, true)).toBe("Anchor");
    });
  });
}
