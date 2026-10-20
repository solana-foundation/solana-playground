import { createTracker } from "../../../shared/lib/telemetry";
import type { NoParams } from "../../../shared/lib/telemetry";

export type HomeTile = "new-project" | "tutorials" | "programs";
/** The tiles that open the gallery on their tab; New project unfolds instead */
export type GalleryTile = Exclude<HomeTile, "new-project">;
export type HomeQuickstart = "continue" | "new" | "tutorial";

type HomeEvents = {
  /** Home was shown, on a start with no project */
  home_shown: NoParams;
  /** A user opened one of Home's three tiles */
  home_tile_opened: { tile: HomeTile };
  /** A user opened a tutorial from Home's cards */
  home_tutorial_opened: NoParams;
  /** A user picked one of the phone's quick starts */
  home_quickstart_opened: { id: HomeQuickstart };
  /** A user opened the assistant from Home's composer */
  home_composer_opened: NoParams;
};

export const homeTelemetry = createTracker<HomeEvents>();
