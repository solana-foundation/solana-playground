import { createTracker } from "@/shared/lib/telemetry";
import type { NoParams } from "@/shared/lib/telemetry";

export type HomeTile = "new-project" | "tutorials" | "programs";
/** The tiles that open the Tutorials or Programs page; New project unfolds instead */
export type PageTile = Exclude<HomeTile, "new-project">;
export type HomeQuickstart = "example" | "continue" | "new" | "tutorial";
/** What "Run it" did with the example (`ExampleRun`) */
export type HomeExampleOutcome = "created" | "opened" | "current";
/** Which kind of "Pick up where you left off" row was opened; `current` went back to the work */
export type HomeRecentKind = "project" | "tutorial" | "current";
/**
 * How Home came to show: the start, the navigation's Home, no project left
 * open on `/` (a delete, here, in another tab or by sync), or a way back to
 * `/` with no project open
 */
export type HomeVia = "start" | "nav" | "last-deleted" | "back";
/**
 * How the work took over from Home: the open project picked in the list,
 * the phone's Continue, another project or a route opened (by the user or by
 * sync's adoption on a start), or the navigation's Home over a shared
 * project, which the list cannot name
 */
export type HomeLeaveVia = "current-project" | "continue" | "open" | "nav";

type HomeEvents = {
  /** Home was shown, and how it came to (`HomeVia`) */
  home_shown: { via: HomeVia };
  /** The work took over from Home, and how (`HomeLeaveVia`) */
  home_left: { via: HomeLeaveVia };
  /** A user opened one of Home's three tiles */
  home_tile_opened: { tile: HomeTile };
  /** A user opened a tutorial from Home's cards */
  home_tutorial_opened: NoParams;
  /** A user picked one of the phone's quick starts */
  home_quickstart_opened: { id: HomeQuickstart };
  /**
   * "Run it", or the phone's example quick start, opened the example: made
   * it and left its build to start on its own (`created`), opened it, or went back to it
   */
  home_example_run: { outcome: HomeExampleOutcome };
  /** A user opened a row of "Pick up where you left off" */
  home_recent_opened: { kind: HomeRecentKind };
  /** A user pressed "Try again" after the account check kept failing */
  home_session_retried: NoParams;
  /** A user opened the assistant from Home's composer */
  home_composer_opened: NoParams;
};

export const homeTelemetry = createTracker<HomeEvents>();
