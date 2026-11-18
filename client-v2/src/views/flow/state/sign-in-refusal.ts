// Its own module, with a type import only: the console status and the Build
// surface read it, and their tests load them without the flow's runtime
import type { BuildFailure } from "./stage";

/**
 * Whether a build was refused because nobody is signed in (HOO-2422): not a
 * failed build, so the stage, the status bar and the surface each read it
 * through this one check.
 *
 * @param failure the last build's failure
 */
export const isSignInRefusal = (
  failure: BuildFailure | null | undefined
): failure is Extract<BuildFailure, { kind: "signed-out" }> =>
  failure?.kind === "signed-out";

/**
 * Whether a build was refused because the service is busy (HOO-2907): the
 * user is past a build limit, or the build server's queue is full. Not a
 * failed build either, and the failure holds the wait the server asked for.
 *
 * @param failure the last build's failure
 */
export const isBusyRefusal = (
  failure: BuildFailure | null | undefined
): failure is Extract<BuildFailure, { kind: "busy" }> =>
  failure?.kind === "busy";

/**
 * Whether a build was refused before it ran, for sign-in or because the
 * service is busy: the stage goes back to where it was and the surface says
 * what to do. The one check for what is not a failed build.
 *
 * @param failure the last build's failure
 */
export const isBuildRefusal = (
  failure: BuildFailure | null | undefined
): failure is Extract<BuildFailure, { kind: "signed-out" | "busy" }> =>
  isSignInRefusal(failure) || isBusyRefusal(failure);
