import { createLogger } from "@/shared/lib/logger";
import {
  PgCommand,
  PgExplorer,
  PgFramework,
  PgGlobal,
  isTerminalUnmounted,
} from "@/utils";

const log = createLogger("home:first-run");

/**
 * The first-run example's project, found by this name: "Run it" shows only
 * while the browser holds no project, but another tab or sync can make the
 * example after Home drew it, and then it is opened rather than copied.
 * The Anchor starter stands in until an example is picked.
 */
const EXAMPLE_NAME = "anchor-example";

/** How often, and for how long, the build waits for the work to mount */
const MOUNT_POLL_MS = 100;
const MOUNT_WAIT_MS = 15_000;

/** Why the example's build did not run */
type BuildSkipped =
  | "left-example"
  | "already-building"
  | "terminal-never-mounted";

/**
 * Start the build once a terminal is there to run it. On a first visit Home
 * mounts no work, so the terminal comes only after the new project has
 * replaced Home; until then the command throws `TerminalUnmounted`. Builds
 * only while the example is still the open project (the command builds
 * whatever is open, and the user may have moved on during the wait) and no
 * build runs yet (the stage's Build may have been pressed). Gives
 * up after `MOUNT_WAIT_MS`, leaving the Build stage's own Build button.
 */
const buildWhenMounted = async (): Promise<BuildSkipped | null> => {
  const until = Date.now() + MOUNT_WAIT_MS;
  for (;;) {
    if (PgExplorer.currentWorkspaceName !== EXAMPLE_NAME) return "left-example";
    // The stage's own Build, pressed during the wait, is the one build
    if (PgGlobal.buildLoading) return "already-building";
    try {
      await PgCommand.build.execute();
      return null;
    } catch (e) {
      if (!isTerminalUnmounted(e)) throw e;
      if (Date.now() >= until) return "terminal-never-mounted";
    }
    await new Promise((resolve) => setTimeout(resolve, MOUNT_POLL_MS));
  }
};

/** What "Run it" did: made the example, opened it, or found it open already */
export type ExampleRun = "created" | "opened" | "current";

/**
 * Open the example, find it already open (`current`), or make it and start
 * its one build. The build is part
 * of making it, never read back from storage, so a reload cannot start
 * another (spec `client-v2-first-run`). It is started,
 * not awaited: a build that fails is the Build stage's to show, and the
 * example exists, so this answers `created` either way.
 */
export const runExample = async (): Promise<ExampleRun> => {
  const names = PgExplorer.allWorkspaceNames;
  // Unknown is not empty: making the example now could put it beside work
  // the explorer has not listed yet
  if (!names) throw new Error("The project list has not loaded yet.");
  if (names.includes(EXAMPLE_NAME)) {
    if (PgExplorer.currentWorkspaceName === EXAMPLE_NAME) return "current";
    await PgExplorer.switchWorkspace(EXAMPLE_NAME);
    return "opened";
  }
  const framework = PgFramework.get("Anchor");
  if (!framework) throw new Error("Anchor is not available.");
  const { files } = await framework.getDefaultFiles();
  await PgExplorer.createWorkspace(EXAMPLE_NAME, {
    files,
    defaultOpenFile: framework.defaultOpenFile,
  });
  // Not awaited: the example exists now, and the build is the Build stage's
  // to show, however long it runs. A compile error resolves (the stage lists
  // it), and the user leaving the example or pressing Build is no fault, so
  // those are only noted. A terminal that never mounted is reported, and so
  // is a rejection: the stage may show it as an unreached server, but it
  // could as well be a bug
  buildWhenMounted().then(
    (skipped) => {
      if (skipped === "terminal-never-mounted") {
        log.error(new Error("The example's build found no terminal"), {
          report: true,
          context: { waitedMs: MOUNT_WAIT_MS },
        });
      } else if (skipped) {
        log.info("the example's build was left to the user", {
          context: { reason: skipped },
        });
      }
    },
    (e: unknown) =>
      log.error(e, { report: true, context: { workspace: EXAMPLE_NAME } })
  );
  return "created";
};
