import { useEffect, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgRouter } from "@/utils";
import { homeTelemetry } from "./telemetry";

export type StartView = "pending" | "home" | "work";

const log = createLogger("home:start");

/**
 * How long `/` waits for the explorer before it gives up on Home: IndexedDB
 * held by another tab's upgrade never answers, and the stage would stay
 * empty for good.
 */
export const START_TIMEOUT_MS = 10_000;

/**
 * Home is for a start on `/` with no project open. Any other route opens
 * straight on the work; on `/` the answer waits for the explorer. Projects
 * listed with none current is still Home: sync imports the account's
 * projects without opening them, and the work mounted then throws in the
 * explorer. `useStartView` leaves Home once one is opened.
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
  if (path !== "/") return "work";
  if (workspaces === undefined) return "pending";
  return workspaces.length && current ? "work" : "home";
};

/**
 * Whether the page shows Home, the work, or neither yet. The route
 * initialises the explorer inside the editor's mount, which Home does not
 * have, so on `/` this initialises it first; `PgExplorer.init` runs its calls
 * one after another, so the route's own call later is harmless. Once the
 * work shows it stays for the page load: coming back to Home from an open
 * project is HOO-2118.
 */
export const useStartView = (): StartView => {
  const [view, setView] = useState<StartView>(() =>
    decideStart({
      path: PgRouter.location.pathname,
      workspaces: PgExplorer.allWorkspaceNames,
      current: PgExplorer.currentWorkspaceName,
    })
  );

  useEffect(() => {
    if (view !== "pending") return;
    let live = true;
    const watchdog = setTimeout(() => {
      live = false;
      log.error(
        new Error(`The explorer did not answer within ${START_TIMEOUT_MS} ms`),
        { report: true }
      );
      setView("work");
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
          setView("work");
          return;
        }
        setView(
          decideStart({
            path: PgRouter.location.pathname,
            workspaces,
            current: PgExplorer.currentWorkspaceName,
          })
        );
      })
      .catch((e: unknown) => {
        // The work is the start without Home and still works
        log.error(e, { report: true });
        if (live) setView("work");
      });
    return () => {
      live = false;
      clearTimeout(watchdog);
    };
  }, [view]);

  useEffect(() => {
    if (view !== "home") return;
    homeTelemetry.track("home_shown", {});
    // Leaves once a project is open, not once one exists: sync imports the
    // account's projects without opening them (`PgExplorer.importWorkspace`),
    // and the work mounted with projects listed and none current throws in
    // the explorer. The session's `adopt` (effects/session) opens the newest
    // one right after, through `PgExplorer.switchWorkspace`.
    const toWork = () => {
      if (PgExplorer.currentWorkspaceName) setView("work");
    };
    const subs = [
      // A project made here, or the account's opened after arriving by sync
      PgExplorer.onDidCreateWorkspace(toWork),
      PgExplorer.onDidSwitchWorkspace(toWork),
      PgRouter.onDidChangePath((path) => {
        if (path !== "/") setView("work");
      }),
    ];
    return () => subs.forEach((s) => s.dispose());
  }, [view]);

  return view;
};
