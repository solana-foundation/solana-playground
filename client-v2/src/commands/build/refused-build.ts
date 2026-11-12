/**
 * Whether the open project's last build was refused for sign-in.
 *
 * Such a refusal never reached the compiler, so the saved verdict
 * (`lastBuildFailed`) stays as it was. Without this mark, a passing build
 * followed by an edit and a refusal would let Deploy reuse the binary of the
 * code before the edit with no warning. The mark lives in memory only: a
 * reload drops it, the same as any edit made since the last build.
 */
let refusedIn: string | undefined;

/** Mark the project whose build sign-in refused */
export const markBuildRefused = (workspaceId: string | undefined) => {
  refusedIn = workspaceId;
};

/** Clear the mark: a build reached the compiler or failed for another reason */
export const clearBuildRefused = () => {
  refusedIn = undefined;
};

/** True when sign-in refused this project's last build */
export const isBuildRefused = (workspaceId: string | undefined) =>
  workspaceId !== undefined && refusedIn === workspaceId;
