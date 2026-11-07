import { useCallback, useEffect, useState } from "react";

import { isHomePath, isStartPath } from "@/routes/catalog-paths";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgRouter } from "@/utils";

import type { HomeLeaveVia, HomeVia } from "./telemetry";
import { homeTelemetry } from "./telemetry";

export type StartView = "pending" | "home" | "work";

const log = createLogger("home:start");

/**
 * How long a start path waits for the explorer before it gives up on
 * Home: IndexedDB held by another tab's upgrade never answers, and the
 * stage would stay empty for good.
 */
export const START_TIMEOUT_MS = 10_000;

/**
 * Home is for a start on Home's own path, or on `/` (or a link to a page)
 * with no project open. Any other route opens straight on the work; on
 * those the answer waits for the explorer. Projects listed with none
 * current is still Home: sync imports the account's projects without
 * opening them, and the work mounted then throws in the explorer. `useStartView` leaves Home once one is opened.
 */
export const decideStart = ({
  path,
  workspaces,
  current,
}: {
  path: string;
  workspaces: readonly string[] | undefined;
  current: string | undefined;
}): StartView => {
  if (!isStartPath(path)) return "work";
  if (workspaces === undefined) return "pending";
  if (isHomePath(path)) return "home";
  return workspaces.length && current ? "work" : "home";
};

/**
 * Whether the work can be drawn: anywhere but a start path, or on one with a
 * project open (a temporary one counts; it has no name). There with none
 * open the explorer throws, so Home is the only page.
 */
const workDrawable = () =>
  !isStartPath(PgRouter.location.pathname) ||
  PgExplorer.isTemporary ||
  PgExplorer.currentWorkspaceName !== undefined;

/**
 * The open project, by its stable id where it has one: sync renames a project
 * to follow another device by re-opening it under the new name, and that is
 * still the project Home shows over
 */
const openProject = () =>
  PgExplorer.currentWorkspaceName &&
  (PgExplorer.currentWorkspaceId ?? PgExplorer.currentWorkspaceName);

/** The start's answer, as what the page shows */
const startShown = (view: StartView): Shown =>
  view === "home" ? { view, via: "start" } : { view };

/** What the page shows, and for Home how it came to show */
type Shown = { view: "home"; via: HomeVia } | { view: "pending" | "work" };

export type PageView = {
  view: StartView;
  /**
   * Whether the work stays mounted under Home: whenever it can be drawn.
   * Going back then finds the editor and the console as they were; a
   * lesson's frame is drawn again by its route, at its saved page.
   */
  workKept: boolean;
  /** How Home came to show, while it shows */
  homeVia: HomeVia | undefined;
  /** Show Home from the work (the navigation's Home) */
  showHome: (via: HomeVia) => void;
  /** Go back to the work, when there is one to go back to */
  leaveHome: (via: HomeLeaveVia) => void;
};

/**
 * Whether the page shows Home, the work, or neither yet, for the whole page
 * load. The start shows Home on `/` with no project open; the route
 * initialises the explorer inside the editor's mount, which Home does not
 * have, so on `/` this initialises it first (`PgExplorer.init` runs its calls
 * one after another, so the route's own call later is harmless). After the
 * start Home comes back from the navigation (`showHome`) and on its own
 * whenever the page ends up on `/` with no project open: the last one
 * deleted, here, by another tab or by sync, or a way back to `/`. Home's own
 * path, `/home`, always shows Home, over the work when there is one. Any
 * other route draws its own page without a project (a lesson's, before it
 * starts), so Home never shows there by itself.
 */
export const useStartView = (): PageView => {
  const [shown, setShown] = useState<Shown>(() =>
    startShown(
      decideStart({
        path: PgRouter.location.pathname,
        workspaces: PgExplorer.allWorkspaceNames,
        current: PgExplorer.currentWorkspaceName,
      })
    )
  );
  const [workKept, setWorkKept] = useState(workDrawable);
  const view = shown.view;

  useEffect(() => {
    if (view !== "pending") return;
    let live = true;
    const watchdog = setTimeout(() => {
      live = false;
      log.error(
        new Error(`The explorer did not answer within ${START_TIMEOUT_MS} ms`),
        { report: true }
      );
      setShown({ view: "work" });
    }, START_TIMEOUT_MS);
    PgExplorer.init()
      .finally(() => clearTimeout(watchdog))
      .then(() => {
        if (!live) return;
        const workspaces = PgExplorer.allWorkspaceNames;
        if (workspaces === undefined) {
          // An init that lists nothing is a broken explorer, not a first
          // visit; the work is the start without Home and copes
          log.error(new Error("The explorer listed no projects after init"), {
            report: true,
          });
          setShown({ view: "work" });
          return;
        }
        setShown(
          startShown(
            decideStart({
              path: PgRouter.location.pathname,
              workspaces,
              current: PgExplorer.currentWorkspaceName,
            })
          )
        );
      })
      .catch((e: unknown) => {
        // The work is the start without Home and still works
        log.error(e, { report: true });
        if (live) setShown({ view: "work" });
      });
    return () => {
      live = false;
      clearTimeout(watchdog);
    };
  }, [view]);

  // Whatever shows, the explorer and the route decide whether the work can
  // be drawn; the work cannot be drawn on a start path with no project
  // open, so Home takes over there
  useEffect(() => {
    // A lesson's route goes to `/` by itself once its project, the last one,
    // is deleted; that arrival is the delete's, not a way back
    let lastDeleted = false;
    const check = (via: HomeVia) => {
      const drawable = workDrawable();
      setWorkKept(drawable);
      if (drawable) {
        // A project open again: the delete is no longer what brings Home
        if (PgExplorer.currentWorkspaceName) lastDeleted = false;
        return;
      }
      const shownVia = lastDeleted ? "last-deleted" : via;
      lastDeleted = false;
      setShown((now) =>
        now.view === "work" ? { view: "home", via: shownVia } : now
      );
    };
    const subs = [
      PgExplorer.onDidSwitchWorkspace(() => check("last-deleted")),
      PgExplorer.onDidInit(() => check("last-deleted")),
      PgExplorer.onDidDeleteWorkspace(() => {
        lastDeleted = PgExplorer.allWorkspaceNames?.length === 0;
        check("last-deleted");
      }),
      // Home's own path, come back to by Back or Forward, shows
      // Home over the work as the navigation's Home does
      PgRouter.onDidChangePath((path) => {
        if (!isHomePath(path)) return check("back");
        setWorkKept(workDrawable());
        setShown((now) =>
          now.view === "work" ? { view: "home", via: "back" } : now
        );
      }),
    ];
    return () => subs.forEach((s) => s.dispose());
  }, []);

  const via = shown.view === "home" ? shown.via : undefined;
  useEffect(() => {
    if (!via) return;
    homeTelemetry.track("home_shown", { via });
    // Leaves once a project other than the one Home showed over is open, not
    // once one exists: sync imports the account's projects without opening
    // them (`PgExplorer.importWorkspace`), and the work mounted with projects
    // listed and none current throws in the explorer; the session's `adopt`
    // (effects/session) opens the newest one right after, through
    // `PgExplorer.switchWorkspace`. The project Home showed over is re-opened
    // by sync too (a merge, a reconcile on refocus, a rename), which is no reason to
    // leave a Home the user asked for.
    const over = openProject();
    const from = PgRouter.location.pathname;
    // A new project switches, then announces itself: one way out, said once
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      homeTelemetry.track("home_left", { via: "open" });
      setShown({ view: "work" });
    };
    const toWork = () => {
      const current = openProject();
      if (current && current !== over) leave();
    };
    // Whether the path has moved since Home showed (normally to Home's own),
    // after which Back to where it opened is a way out
    let moved = false;
    const subs = [
      // A project made here, or the account's opened after arriving by sync
      PgExplorer.onDidCreateWorkspace(toWork),
      PgExplorer.onDidSwitchWorkspace(toWork),
      // Called at once with the path Home opened on, which is no way out
      // until the path first moves off it. A route's work, or `/` with a
      // project open, is; a page's link opens over Home and keeps it.
      PgRouter.onDidChangePath((path) => {
        if (path !== from) moved = true;
        if (!moved) return;
        if (!isStartPath(path) || (path === "/" && workDrawable())) leave();
      }),
    ];
    return () => subs.forEach((s) => s.dispose());
  }, [via]);

  // Not while the start is pending: its watchdog and its reports would go
  // with it, and Home shows by itself once the start is decided
  // A shared project (temporary) has no row in the list to go back by, so
  // there the navigation's Home, picked again, is the way back
  const showHome = useCallback(
    (nextVia: HomeVia) => {
      if (view === "home" && nextVia === "nav" && PgExplorer.isTemporary) {
        homeTelemetry.track("home_left", { via: "nav" });
        setShown({ view: "work" });
        return;
      }
      setShown((now) =>
        now.view === "work" ? { view: "home", via: nextVia } : now
      );
    },
    [view]
  );

  const leaveHome = useCallback(
    (leftVia: HomeLeaveVia) => {
      if (view !== "home" || !workDrawable()) return;
      homeTelemetry.track("home_left", { via: leftVia });
      setShown({ view: "work" });
    },
    [view]
  );

  return { view, workKept, homeVia: via, showHome, leaveHome };
};
