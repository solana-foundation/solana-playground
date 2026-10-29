import { useCallback, useEffect, useState } from "react";

import { isMissing } from "@/shared/lib/is-missing";
import { createLogger } from "@/shared/lib/logger";
// By module, not the utils barrel, which reads the build's globals on import
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgTutorial } from "../../../utils/tutorial/tutorial";
import { progressOf } from "./progress";
import type { TutorialProgress } from "./progress";

const log = createLogger("tutorial:progress");

const NEW: TutorialProgress = { state: "new" };

/**
 * Every registered tutorial's progress, by name, read on mount and again
 * whenever the explorer initialises or its workspace list changes (a start,
 * a delete, a sync import). Before the explorer knows its workspaces every
 * tutorial reads as new. A started tutorial whose saved progress cannot be
 * read shows as started on page 1: a missing file is logged as a warning, any
 * other failure is reported, and none is thrown into the render.
 */
export const useTutorialProgress = (): ((name: string) => TutorialProgress) => {
  const [progress, setProgress] = useState<Map<string, TutorialProgress>>(
    () => new Map()
  );

  useEffect(() => {
    let live = true;
    // Only the latest read lands: one begun on mount can finish after the
    // one the explorer's init begins
    let latest = 0;
    const update = () => {
      const n = ++latest;
      read()
        .then((next) => {
          if (live && n === latest) setProgress(next);
        })
        // The cards keep what they showed
        .catch((e: unknown) => log.error(e, { report: true }));
    };
    // A start creates the workspace; sync imports one without a switch;
    // another tab's list arrives as a list change
    const subs = [
      PgExplorer.onDidInit(update),
      PgExplorer.onDidCreateWorkspace(update),
      PgExplorer.onDidDeleteWorkspace(update),
      PgExplorer.onDidChangeWorkspaceList(update),
    ];
    update();
    return () => {
      live = false;
      subs.forEach((sub) => sub.dispose());
    };
  }, []);

  return useCallback((name) => progress.get(name) ?? NEW, [progress]);
};

const read = async (): Promise<Map<string, TutorialProgress>> => {
  // Before the explorer is initialised nothing is started yet, and
  // `isStarted` would throw
  if (!PgExplorer.allWorkspaceNames) return new Map();

  const entries = await Promise.all(
    PgTutorial.all.map(async (t) => {
      if (!PgTutorial.isStarted(t.name)) return [t.name, NEW] as const;
      let meta = null;
      try {
        meta = await PgTutorial.getMetadata(t.name);
      } catch (e) {
        if (isMissing(e)) {
          log.warn(`no saved progress for ${t.name}`);
        } else {
          log.error(e, { report: true, context: { tutorial: t.name } });
        }
      }
      return [t.name, progressOf(true, meta, t.pageCount)] as const;
    })
  );
  return new Map(entries);
};
