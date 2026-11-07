import { useEffect, useRef } from "react";

import { catalogPageOfPath, pathOfCatalogPage } from "@/routes/catalog-paths";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgRouter, PgTutorial } from "@/utils";
import type { ShownPage } from "@/widgets/catalog";
import { catalogPage } from "@/widgets/catalog";
import type { StartView } from "@/widgets/home";

const log = createLogger("flow:view-path");

/**
 * The open project's own path: a tutorial's route (with its saved page), or
 * `/` for any other project
 */
const openWork = async () => {
  const name = PgExplorer.currentWorkspaceName;
  // No project: Home stands in on any start path, and `/` would only run
  // the same route again
  if (!name) return;
  if (PgTutorial.isWorkspaceTutorial(name)) await PgTutorial.open(name);
  else await PgRouter.navigate("/");
};

const go = (move: () => Promise<void>) =>
  move().catch((e: unknown) => log.error(e, { report: true }));

/**
 * Keep the address bar on the page shown, both ways: New project, Tutorials
 * and Programs each show on their own path (`/new`, `/tutorials`,
 * `/programs`), so Back, Forward and a reload follow them.
 *
 * A path the user comes to (Back, Forward, a link, typed) opens the page it
 * names, or closes the page shown. A page the user opens pushes its path,
 * one history entry; a page closed while the path is still its own goes
 * back to what it showed over: the path Home showed on, or the open
 * project's. A pick that navigates itself (a tutorial's card or row opens
 * its route) has moved the path on before the page closes, and that path
 * stays; a plain project's row switches without navigating, so its close
 * goes back to `/` here. A shared project's path is never moved: it holds
 * the only copy. Home has no path of its own: a page over it goes back to
 * the path Home showed on.
 */
export const useViewPath = ({
  view,
  catalog,
}: {
  view: StartView;
  catalog: ShownPage | undefined;
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

  const was = useRef<ShownPage | undefined>(undefined);
  // The path Home showed on, while it shows: where a page over it goes back
  const homeAt = useRef<string | undefined>(undefined);
  useEffect(() => {
    const before = was.current;
    was.current = catalog;
    if (view === "pending") return;
    const path = PgRouter.location.pathname;
    if (view !== "home") homeAt.current = undefined;
    else if (homeAt.current === undefined && !catalogPageOfPath(path)) {
      homeAt.current = path;
    }
    // A shared project (a docs link, a gist) lives only on its own path:
    // another route would init the explorer again and drop it unsaved
    if (PgExplorer.isTemporary) return;
    if (catalog) {
      if (catalogPageOfPath(path) !== catalog) {
        go(() => PgRouter.navigate(pathOfCatalogPage(catalog)));
      }
      return;
    }
    // Only a page that closed on its own path goes back; any other path is
    // where its pick, or Back, went
    if (!before || catalogPageOfPath(path) !== before) return;
    if (view === "home") {
      // Home that showed on the page's own path (a reload there with no
      // project) stands on `/`
      const back = homeAt.current ?? "/";
      go(() => PgRouter.navigate(back));
      return;
    }
    go(openWork);
  }, [view, catalog]);
};
