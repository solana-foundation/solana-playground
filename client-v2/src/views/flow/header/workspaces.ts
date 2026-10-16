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
