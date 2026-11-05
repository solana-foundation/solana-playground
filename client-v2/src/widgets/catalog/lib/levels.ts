/* eslint-disable layers/curry-order, max-params -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { TutorialData } from "@/utils";

type Level = TutorialData["level"];
type Framework = NonNullable<TutorialData["framework"]>;

/** The framework filter's value: every framework, or one */
export type FrameworkFilter = "all" | Framework;

/** The levels in the order the page lists them */
export const LEVELS: readonly Level[] = [
  "Beginner",
  "Intermediate",
  "Advanced",
];

/** Cards a level shows before Show all: two rows of the list's two columns */
export const LEVEL_FIRST = 4;

/** The filter's choices, in the menu's order */
export const FRAMEWORKS: readonly { value: FrameworkFilter; label: string }[] =
  [
    { value: "all", label: "All" },
    { value: "Anchor", label: "Anchor" },
    { value: "Seahorse", label: "Seahorse" },
    { value: "Native", label: "Native" },
  ];

/** The items by level, in `LEVELS` order, leaving out an empty level */
export const byLevel = <T extends { level: Level }>(items: readonly T[]) =>
  LEVELS.map((level) => ({
    level,
    items: items.filter((t) => t.level === level),
  })).filter((g) => g.items.length > 0);

/**
 * How many frameworks the items hold. The filter is drawn only from two up:
 * with one, every choice but All would show the same list or nothing
 */
export const frameworkCount = (
  items: readonly { framework?: Framework }[]
): number => new Set(items.map((t) => t.framework).filter(Boolean)).size;

/** The search field's hint: the count, or the framework while one is picked */
export const searchHint = (count: number, framework: FrameworkFilter) =>
  framework === "all"
    ? `Search ${count} tutorials`
    : `Search ${framework} tutorials`;

/** The status line while searching or filtering: "3 results", or why none */
export const resultsLine = (
  count: number,
  query: string,
  framework: FrameworkFilter
): string => {
  const kind = framework === "all" ? "tutorials" : `${framework} tutorials`;
  const q = query.trim();
  if (count === 0) return q ? `No ${kind} match “${q}”` : `No ${kind} yet`;
  return `${count} ${count === 1 ? "result" : "results"}`;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/catalog/lib/levels", () => {
    const at = (name: string, level: Level, framework?: Framework) => ({
      name,
      level,
      framework,
    });

    it("groups by level in order and drops an empty level", () => {
      const groups = byLevel([
        at("Zero Copy", "Advanced"),
        at("Hello Anchor", "Beginner"),
      ]);
      expect(groups.map((g) => g.level)).toEqual(["Beginner", "Advanced"]);
      expect(groups[1].items.map((t) => t.name)).toEqual(["Zero Copy"]);
    });

    it("counts the frameworks the items hold", () => {
      expect(
        frameworkCount([
          at("a", "Beginner", "Anchor"),
          at("b", "Advanced", "Anchor"),
        ])
      ).toBe(1);
      expect(
        frameworkCount([
          at("a", "Beginner", "Anchor"),
          at("b", "Beginner", "Seahorse"),
          at("c", "Beginner"),
        ])
      ).toBe(2);
    });

    it("hints at the count, or the framework picked", () => {
      expect(searchHint(3, "all")).toBe("Search 3 tutorials");
      expect(searchHint(3, "Seahorse")).toBe("Search Seahorse tutorials");
    });

    it("says how many matched, or why nothing did", () => {
      expect(resultsLine(1, "anchor", "all")).toBe("1 result");
      expect(resultsLine(3, "", "Anchor")).toBe("3 results");
      expect(resultsLine(0, " zzz ", "all")).toBe("No tutorials match “zzz”");
      expect(resultsLine(0, "", "Native")).toBe("No Native tutorials yet");
    });
  });
}
