export interface ProjectEntry {
  name: string;
  /** The stable workspace id pins key on; `null` while the explorer has none */
  id: string | null;
  isLesson: boolean;
  pinned: boolean;
}

/**
 * The navigation's one list, as the prototype draws it: a started lesson is
 * a row among the projects, drawn like one. `isLesson` changes only how it
 * opens and what its menu offers: opening a lesson has to go through
 * `PgTutorial.open`, which restores its route and page, and a lesson cannot
 * be renamed, since it is recognised by its workspace name. Pinned entries lead; otherwise the
 * explorer's order stands.
 */
export const listProjects = (
  names: readonly string[],
  deps: {
    idOf: (name: string) => string | undefined;
    isLesson: (name: string) => boolean;
  },
  pins: readonly string[]
) => {
  const projects = names.map((name): ProjectEntry => {
    const id = deps.idOf(name) ?? null;
    return {
      name,
      id,
      isLesson: deps.isLesson(name),
      pinned: id !== null && pins.includes(id),
    };
  });
  return pinnedFirst(projects);
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
    };

    describe("listProjects", () => {
      it("lists lessons among projects, marked, in the given order", () => {
        const projects = listProjects(
          ["beta", "Hello Anchor", "alpha"],
          deps,
          []
        );
        expect(projects.map((p) => [p.name, p.isLesson])).toEqual([
          ["beta", false],
          ["Hello Anchor", true],
          ["alpha", false],
        ]);
      });

      it("puts pinned entries first, by workspace id", () => {
        const projects = listProjects(["beta", "alpha"], deps, ["id-a"]);
        expect(projects.map((p) => [p.name, p.pinned])).toEqual([
          ["alpha", true],
          ["beta", false],
        ]);
      });

      it("gives an entry the explorer has no id for no pin", () => {
        const projects = listProjects(["ghost"], deps, ["undefined"]);
        expect(projects[0]).toEqual({
          name: "ghost",
          id: null,
          isLesson: false,
          pinned: false,
        });
      });

      it("handles an empty list", () => {
        expect(listProjects([], deps, [])).toEqual([]);
      });
    });
  });
}
