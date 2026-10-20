import { useEffect, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgRouter } from "@/utils";
import { homeTelemetry } from "./telemetry";

export type StartView = "pending" | "home" | "work";

const log = createLogger("home:start");

/**
 * Home is for a start on `/` with no project. Any other route opens straight
 * on the work; on `/` the answer waits for the explorer.
 */
export const decideStart = ({
  path,
  workspaces,
}: {
  path: string;
  workspaces: readonly string[] | undefined;
}): StartView => {
  if (path !== "/") return "work";
  if (workspaces === undefined) return "pending";
  return workspaces.length ? "work" : "home";
};

/**
 * Whether the page shows Home, the work, or neither yet. The route
 * initialises the explorer inside the editor's mount, which Home does not
 * have, so on `/` this initialises it first; `PgExplorer.init` runs its calls
 * one after another, so the route's own call later is harmless. Once the
 * work shows it stays for the page load: coming back to Home from an open
 * project is not supported yet.
 */
export const useStartView = (): StartView => {
  const [view, setView] = useState<StartView>(() =>
    decideStart({
      path: PgRouter.location.pathname,
      workspaces: PgExplorer.allWorkspaceNames,
    })
  );

  useEffect(() => {
    if (view !== "pending") return;
    let live = true;
    PgExplorer.init()
      .then(() => {
        if (!live) return;
        const workspaces = PgExplorer.allWorkspaceNames;
        if (workspaces === undefined) {
          // An init that lists nothing is a broken explorer, not a first
          // visit; the work is today's start and copes without Home
          log.error(new Error("The explorer listed no projects after init"), {
            report: true,
          });
          setView("work");
          return;
        }
        setView(decideStart({ path: PgRouter.location.pathname, workspaces }));
      })
      .catch((e: unknown) => {
        // The work is today's start and still works without Home
        log.error(e, { report: true });
        if (live) setView("work");
      });
    return () => {
      live = false;
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
