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
