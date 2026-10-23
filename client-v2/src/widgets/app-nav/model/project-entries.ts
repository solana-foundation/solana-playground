export interface ProjectEntry {
  name: string;
  /** The stable workspace id pins key on; `null` while the explorer has none */
  id: string | null;
  isLesson: boolean;
  /**
   * "3 of 4" or "done" for the open lesson, "<n> steps" for another; `null`
   * for a project, or a lesson with no lesson path
   */
  progress: string | null;
  pinned: boolean;
}

/**
 * The navigation's two groups.
 *
 * Lessons and projects are kept apart because they behave differently:
 * opening a lesson has to go through `PgTutorial.open`, which restores its
 * route and page, and a lesson cannot be renamed, since it is recognised by
 * its workspace name. Pinned entries lead their group; otherwise the
 * explorer's order stands.
 */
export const listProjects = (
  names: readonly string[],
  deps: {
    idOf: (name: string) => string | undefined;
    isLesson: (name: string) => boolean;
    progressOf: (name: string) => string | null;
  },
  pins: readonly string[]
) => {
  const projects: ProjectEntry[] = [];
  const lessons: ProjectEntry[] = [];

  for (const name of names) {
    const id = deps.idOf(name) ?? null;
    const isLesson = deps.isLesson(name);
    const entry: ProjectEntry = {
      name,
      id,
      isLesson,
      progress: isLesson ? deps.progressOf(name) : null,
      pinned: id !== null && pins.includes(id),
    };
    (isLesson ? lessons : projects).push(entry);
  }

  return { projects: pinnedFirst(projects), lessons: pinnedFirst(lessons) };
};

const pinnedFirst = (entries: ProjectEntry[]) => [
  ...entries.filter((entry) => entry.pinned),
  ...entries.filter((entry) => !entry.pinned),
];

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/app-nav/model/project-entries", () => {
    const ids: Record<string, string> = {
      alpha: "id-a",
      beta: "id-b",
      "Hello Anchor": "id-h",
    };
    const deps = {
      idOf: (name: string) => ids[name],
      isLesson: (name: string) => name.startsWith("Hello "),
      progressOf: (name: string) => (name === "Hello Anchor" ? "3 of 4" : null),
    };

    describe("listProjects", () => {
      it("splits lessons from projects and keeps the given order", () => {
        const { projects, lessons } = listProjects(
          ["beta", "Hello Anchor", "alpha"],
          deps,
          []
        );
        expect(projects.map((p) => p.name)).toEqual(["beta", "alpha"]);
        expect(lessons.map((l) => l.name)).toEqual(["Hello Anchor"]);
        expect(lessons[0].progress).toBe("3 of 4");
        expect(projects[0].progress).toBeNull();
      });

      it("puts pinned entries first in their group, by workspace id", () => {
        const { projects } = listProjects(["beta", "alpha"], deps, ["id-a"]);
        expect(projects.map((p) => [p.name, p.pinned])).toEqual([
          ["alpha", true],
          ["beta", false],
        ]);
      });

      it("gives an entry the explorer has no id for no pin", () => {
        const { projects } = listProjects(["ghost"], deps, ["undefined"]);
        expect(projects[0]).toEqual({
          name: "ghost",
          id: null,
          isLesson: false,
          progress: null,
          pinned: false,
        });
      });

      it("handles an empty list", () => {
        expect(listProjects([], deps, [])).toEqual({
          projects: [],
          lessons: [],
        });
      });
    });
  });
}
