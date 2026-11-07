import { PgRouter } from "../../utils";
import { HOME_PATH } from "../catalog-paths";
import { handleRoute } from "../common";

/**
 * Home's own path. The page shows Home here (`useStartView`); the route
 * mounts the open project's work under it, as `/` does, so going back to
 * the work finds its files and tabs as they were (a lesson's frame is drawn
 * again by its route).
 */
export const home = PgRouter.create({
  path: HOME_PATH,
  handle: () => handleRoute(),
});
