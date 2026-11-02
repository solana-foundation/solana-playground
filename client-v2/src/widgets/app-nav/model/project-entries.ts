import type { TutorialProgress } from "@/entities/tutorial";
import type { SyncMarker } from "@/features/persistence";

/** How far a started lesson is, as its row shows it */
export type LessonProgress = Exclude<TutorialProgress, { state: "new" }>;

export interface ProjectEntry {
  name: string;
  /** The stable workspace id pins key on; `null` while the explorer has none */
  id: string | null;
  isLesson: boolean;
  pinned: boolean;
  /** Where its work lives, when not in the account (`syncMarkerOf`) */
  marker: SyncMarker | null;
  /**
   * A lesson's page or its completion. `null` means show nothing: a project,
   * or a lesson whose progress is not read yet
   */
  progress: LessonProgress | null;
}

/**
 * The navigation's one list, as the prototype draws it: a started lesson is a
 * row among the projects, drawn like one. `isLesson` changes only how it opens
 * and what its menu offers: opening a lesson has to go through
 * `PgTutorial.open`, which restores its route and page, and a lesson cannot be
 * renamed, since it is recognised by its workspace name. A lesson also carries
 * its progress, which its row shows at its end. Pinned entries lead; otherwise
 * the explorer's order stands.
 */
export const listProjects = (
  names: readonly string[],
  deps: {
    idOf: (name: string) => string | undefined;
    isLesson: (name: string) => boolean;
    /** The last marker read for the workspace, by name */
    markerOf: (name: string) => SyncMarker | null;
    /** A tutorial's progress, by its name, which is its workspace's */
    progressOf: (name: string) => TutorialProgress;
  },
  pins: readonly string[]
) => {
  const projects = names.map((name): ProjectEntry => {
    const id = deps.idOf(name) ?? null;
    const isLesson = deps.isLesson(name);
    const progress = isLesson ? deps.progressOf(name) : null;
    return {
      name,
      id,
      isLesson,
      pinned: id !== null && pins.includes(id),
      marker: deps.markerOf(name),
      progress: progress && progress.state !== "new" ? progress : null,
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
      markerOf: (name: string): SyncMarker | null =>
        name === "beta" ? "this-browser" : null,
      progressOf: (name: string): TutorialProgress =>
        name === "Hello Anchor"
          ? { state: "started", page: 3, pages: 5 }
          : { state: "new" },
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
          marker: null,
          progress: null,
        });
      });

      it("carries a lesson's progress, and none for a project", () => {
        const projects = listProjects(
          ["beta", "Hello Anchor", "Hello Native"],
          {
            idOf: deps.idOf,
            isLesson: deps.isLesson,
            markerOf: deps.markerOf,
            // A project whose name a finished tutorial also has: not a lesson
            progressOf: (name) =>
              name === "beta" ? { state: "completed" } : deps.progressOf(name),
          },
          []
        );
        expect(projects.map((p) => [p.name, p.progress])).toEqual([
          ["beta", null],
          ["Hello Anchor", { state: "started", page: 3, pages: 5 }],
          // Not read yet: nothing to show rather than a guess
          ["Hello Native", null],
        ]);
      });

      it("carries each project's sync marker", () => {
        const projects = listProjects(["beta", "alpha"], deps, []);
        expect(projects.map((p) => [p.name, p.marker])).toEqual([
          ["beta", "this-browser"],
          ["alpha", null],
        ]);
      });

      it("handles an empty list", () => {
        expect(listProjects([], deps, [])).toEqual([]);
      });
    });
  });
}
