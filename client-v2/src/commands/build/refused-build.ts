/**
 * Whether the open project's last build was refused for sign-in.
 *
 * Such a refusal never reached the compiler, so the saved verdict
 * (`lastBuildFailed`) stays as it was. Without this mark, a passing build
 * followed by an edit and a refusal would let Deploy reuse the binary of the
 * code before the edit with no warning. The mark lives in memory only: a
 * reload drops it, the same as any edit made since the last build. Marks are
 * kept per project, so a build in one never clears another's.
 */
const refused = new Set<string>();

/** Mark the project whose build sign-in refused */
export const markBuildRefused = (workspaceId: string | undefined) => {
  if (workspaceId !== undefined) refused.add(workspaceId);
};

/** Clear this project's mark: its build reached the compiler or failed for another reason */
export const clearBuildRefused = (workspaceId: string | undefined) => {
  if (workspaceId !== undefined) refused.delete(workspaceId);
};

/** True when sign-in refused this project's last build */
export const isBuildRefused = (workspaceId: string | undefined) =>
  workspaceId !== undefined && refused.has(workspaceId);
