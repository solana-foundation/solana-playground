import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";
import type { StageStatus } from "../state/stage";

/**
 * The build report this workspace may show, or `null`.
 *
 * `PgBuildOutput` holds one value for the whole session, so it outlives the
 * project that produced it: opening a second project left the first one's
 * report on screen, announcing a build the new workspace never had. The
 * stepper reads the workspace's own record and was right; only the surface
 * was not.
 *
 * Output recorded before the tag existed counts as someone else's - it cannot
 * be attributed, and claiming it for the current workspace is the very bug.
 */
export const ownOutput = (
  out: BuildOutput | null,
  workspace: string | null
): BuildOutput | null =>
  out && workspace && out.workspace === workspace ? out : null;

/**
 * Whether the surface is showing a build the workspace remembers but this
 * page never watched.
 *
 * `PgProgramInfo.lastBuildFailed` survives a reload; the compiler's output
 * does not. Without this the surface offered a first build over a verdict
 * that says one already happened, and for a restored failure it went further
 * and named a cause ("failed before the compiler ran") it cannot know.
 *
 * `buildStartedAt` is the discriminator: a build this session started sets
 * it, so a missing report there means the run produced none, which is a
 * different story with its own surface.
 */
export const isRestoredBuild = (
  settled: StageStatus,
  own: BuildOutput | null,
  buildStartedAt: number | null
) =>
  own === null &&
  buildStartedAt === null &&
  (settled === "done" || settled === "failed");
