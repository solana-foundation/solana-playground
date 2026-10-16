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
