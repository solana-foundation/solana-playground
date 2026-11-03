/** A row of "Pick up where you left off" */
export interface RecentEntry {
  name: string;
  /** A started tutorial opens at its page, so it opens another way */
  kind: "project" | "tutorial";
  /** The project open under Home: picking it goes back to the work */
  current: boolean;
}

const RECENT_SHOWN = 3;

/**
 * Up to three projects to pick up: the open one first, as the explorer
 * re-opens the last used on a load, then the rest by when they joined this
 * browser's list, latest first. The explorer keeps no times; it appends a
 * project it makes or sync imports, and a rename keeps its place.
 */
export const recentProjects = (
  names: readonly string[],
  current: string | undefined,
  isLesson: (name: string) => boolean
): RecentEntry[] => {
  const rest = names.filter((name) => name !== current).reverse();
  const ordered =
    current && names.includes(current) ? [current, ...rest] : rest;
  return ordered.slice(0, RECENT_SHOWN).map((name) => ({
    name,
    kind: isLesson(name) ? "tutorial" : "project",
    current: name === current,
  }));
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/home/model/recent", () => {
    const noLessons = () => false;

    describe("recentProjects", () => {
      it("puts the open project first, then the newest, three in all", () => {
        const recent = recentProjects(
          ["a", "b", "c", "d", "e"],
          "b",
          noLessons
        );
        expect(recent.map((r) => [r.name, r.current])).toEqual([
          ["b", true],
          ["e", false],
          ["d", false],
        ]);
      });

      it("lists the newest first when none is open", () => {
        const recent = recentProjects(
          ["a", "b", "c", "d"],
          undefined,
          noLessons
        );
        expect(recent.map((r) => r.name)).toEqual(["d", "c", "b"]);
      });

      it("marks a started tutorial", () => {
        const recent = recentProjects(
          ["a", "Hello Anchor"],
          undefined,
          (name) => name === "Hello Anchor"
        );
        expect(recent.map((r) => [r.name, r.kind])).toEqual([
          ["Hello Anchor", "tutorial"],
          ["a", "project"],
        ]);
      });

      it("lists nothing for a browser with no project", () => {
        expect(recentProjects([], undefined, noLessons)).toEqual([]);
      });
    });
  });
}
