export interface WorkspaceEntry {
  name: string;
  isLesson: boolean;
  /** e.g. "3 of 4" or "done", or `null` for a project or an unpathed
   * lesson */
  progress: string | null;
}

/**
 * Split the workspace list the switcher shows.
 *
 * Lessons and projects are grouped rather than interleaved because they
 * behave differently: choosing a lesson has to go through
 * `PgTutorial.open`, which restores its route and page, while a project
 * is a plain `switchWorkspace`.
 */
export const groupWorkspaces = (
  names: string[],
  isLesson: (name: string) => boolean,
  progressOf: (name: string) => string | null
) => {
  const lessons: WorkspaceEntry[] = [];
  const projects: WorkspaceEntry[] = [];

  for (const name of names) {
    const entry: WorkspaceEntry = {
      name,
      isLesson: isLesson(name),
      progress: isLesson(name) ? progressOf(name) : null,
    };
    (entry.isLesson ? lessons : projects).push(entry);
  }

  return { lessons, projects };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/header/workspaces", () => {
    const isLesson = (n: string) => n.startsWith("Hello ");
    const progressOf = (n: string) => (n === "Hello Anchor" ? "3/4" : null);

    describe("groupWorkspaces", () => {
      it("splits lessons from projects", () => {
        const { lessons, projects } = groupWorkspaces(
          ["flow-demo", "Hello Anchor", "token-vault", "Hello Solana"],
          isLesson,
          progressOf
        );
        expect(lessons.map((l) => l.name)).toEqual([
          "Hello Anchor",
          "Hello Solana",
        ]);
        expect(projects.map((p) => p.name)).toEqual([
          "flow-demo",
          "token-vault",
        ]);
      });

      it("carries progress for a lesson and none for a project", () => {
        const { lessons, projects } = groupWorkspaces(
          ["flow-demo", "Hello Anchor"],
          isLesson,
          progressOf
        );
        expect(lessons[0].progress).toBe("3/4");
        expect(projects[0].progress).toBeNull();
      });

      it("preserves the order it was given inside each group", () => {
        const { projects } = groupWorkspaces(
          ["zeta", "alpha"],
          isLesson,
          progressOf
        );
        expect(projects.map((p) => p.name)).toEqual(["zeta", "alpha"]);
      });

      it("handles an empty list", () => {
        expect(groupWorkspaces([], isLesson, progressOf)).toEqual({
          lessons: [],
          projects: [],
        });
      });
    });
  });
}
