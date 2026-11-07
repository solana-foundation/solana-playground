import { useEffect, useRef } from "react";

import {
  catalogPageOfPath,
  HOME_PATH,
  isHomePath,
  isStartPath,
  pathOfCatalogPage,
} from "@/routes/catalog-paths";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgRouter, PgTutorial } from "@/utils";
import type { CatalogPage } from "@/widgets/catalog";
import { catalogPage } from "@/widgets/catalog";
import type { HomeVia, StartView } from "@/widgets/home";

const log = createLogger("flow:view-path");

/**
 * The open project's own path: a tutorial's route (with its saved page), or
 * `/` for any other project
 */
const openWork = async () => {
  const name = PgExplorer.currentWorkspaceName;
  // No project: the start's fallback shows the work as it is, wherever it
  // is, and `/` would only bring Home back over nothing
  if (!name) return;
  if (PgTutorial.isWorkspaceTutorial(name)) await PgTutorial.open(name);
  else await PgRouter.navigate("/");
};

const go = (move: () => Promise<void>) =>
  move().catch((e: unknown) => log.error(e, { report: true }));

/**
 * Keep the address bar on what the page shows, both ways. Home shows on
 * `/home`, a page on its own path, and the work on its project's path, so
 * each has its own URL and Back and Forward move between them. The last
 * tutorial stays remembered as the open project, but only the work's own
 * path is a tutorial's.
 *
 * A path the user comes to (Back, Forward, a link, typed) opens or closes
 * the page it names, and `useStartView` shows or leaves Home for it; a view
 * the user picks then moves the path, one history entry each. Home that
 * shows on `/` by itself (the start, the last project deleted, Back to `/`
 * with nothing open) stays there: what `/` holds is not this hook's to
 * change, and moving off it would run `/`'s route again. A shared project's
 * path is never moved: it holds the only copy.
 */
export const useViewPath = ({
  view,
  homeVia,
  catalog,
}: {
  view: StartView;
  homeVia: HomeVia | undefined;
  catalog: CatalogPage | undefined;
}) => {
  // A path come to opens or closes its page
  useEffect(() => {
    const sub = PgRouter.onDidChangePath((path) => {
      const page = catalogPageOfPath(path);
      if (page) catalogPage.open(page, "link");
      else catalogPage.close();
    });
    return () => sub.dispose();
  }, []);

  // What the user picks moves the path: only what changed, since a pick
  // that navigates itself (a card's Open, a project's row) closes the page
  // after its path has already moved on
  const was = useRef<{ view: StartView; catalog?: CatalogPage }>(undefined);
  // Home's path while it shows: `/` for Home there by itself, else its own
  const homeAt = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = was.current;
    was.current = { view, catalog };
    if (view === "pending") return;
    // A shared project (a docs link, a gist) lives only on its own path:
    // another route would init the explorer again and drop it unsaved
    if (PgExplorer.isTemporary) return;
    const path = PgRouter.location.pathname;
    if (view !== "home") homeAt.current = undefined;
    else if (!homeAt.current) {
      homeAt.current = path === "/" && homeVia !== "nav" ? "/" : HOME_PATH;
    }
    if (catalog) {
      if (catalogPageOfPath(path) !== catalog) {
        go(() => PgRouter.navigate(pathOfCatalogPage(catalog)));
      }
      return;
    }
    // A page closed: back to what it showed over, unless the path left it
    const closed = !!before?.catalog;
    if (closed && catalogPageOfPath(path) !== before.catalog) return;
    if (view === "home") {
      const at = homeAt.current ?? HOME_PATH;
      if (at === HOME_PATH ? isHomePath(path) : path === at) return;
      if (!closed && before?.view === "home" && !isStartPath(path)) return;
      go(() => PgRouter.navigate(at));
      return;
    }
    // The work on a start path: back to the project's own, except on `/`,
    // whose route resumes the project itself
    if (isStartPath(path) && path !== "/") go(openWork);
  }, [view, homeVia, catalog]);
};
