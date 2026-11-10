import { useState } from "react";

import { startTutorials, useTutorialProgress } from "@/entities/tutorial";
import { PgSession } from "@/features/auth";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgTutorial } from "@/utils";

import { errorMessage } from "../lib/error-message";
import { runExample } from "../model/example";
import type { RecentEntry } from "../model/recent";
import { recentProjectsWith } from "../model/recent";
import { useSessionRetry } from "../model/session-retry";
import type { HomeTile } from "../model/telemetry";
import { homeTelemetry } from "../model/telemetry";
import { useProgramCount } from "../model/use-program-count";
import { useVisit } from "../model/use-visit";
import { needsSessionRetry } from "../model/visit";
import type { HomeStart, TutorialFailure } from "./BaseHome";
import BaseHome from "./BaseHome";

export interface HomeProps {
  onAsk: () => void;
  /** Go back to the project open under Home */
  onContinue: () => void;
  /** Open the New project, Tutorials or Programs page, in Home's place */
  onOpenPage: (page: HomeTile) => void;
}

const log = createLogger("home:actions");

/**
 * Open a recent row. The open project is still under Home, so it goes back
 * to it, never re-reading it under a live editor; a started tutorial opens
 * through `PgTutorial.open`, which restores its route and page.
 */
const openRecentWith =
  (onContinue: () => void) => async (entry: RecentEntry) => {
    const names = PgExplorer.allWorkspaceNames;
    if (!names) throw new Error("The project list has not loaded yet.");
    if (!names.includes(entry.name)) {
      throw new Error(`${entry.name} no longer exists.`);
    }
    // Read now, not when Home drew: another tab or sync may have opened another
    if (entry.name === PgExplorer.currentWorkspaceName) {
      onContinue();
      return "current" as const;
    }
    if (entry.kind === "tutorial") await PgTutorial.open(entry.name);
    else await PgExplorer.switchWorkspace(entry.name);
    return entry.kind;
  };

/**
 * What leads Home, by `useVisit`: the example on a first visit, recent work
 * once there are projects, "Try again" once a failed session check has
 * spent its automatic re-reads, and nothing while the visit is unknown
 */
const useStart = (onContinue: () => void): HomeStart | undefined => {
  const visit = useVisit();
  const progressOf = useTutorialProgress();
  const names = PgExplorer.allWorkspaceNames;
  // A failed session check with no project hangs the visit: retry it, and
  // never fall back to the example, whose build could start for someone
  // signed in
  const retry = useSessionRetry(needsSessionRetry(names, PgSession.readState));
  if (retry.kind === "exhausted") {
    return {
      kind: "retry",
      onRetry: async () => {
        homeTelemetry.track("home_session_retried", {});
        await retry.retry();
      },
    };
  }
  if (visit === "unknown" || !names) return undefined;
  if (visit === "first") {
    return {
      kind: "example",
      onRun: async () => {
        const outcome = await runExample();
        if (outcome === "current") onContinue();
        homeTelemetry.track("home_example_run", { outcome });
      },
    };
  }
  return {
    kind: "recent",
    entries: recentProjectsWith((name) => PgTutorial.isWorkspaceTutorial(name))(
      names,
      PgExplorer.currentWorkspaceName
    ),
    progressOf,
    onOpen: async (entry) => {
      const kind = await openRecentWith(onContinue)(entry);
      homeTelemetry.track("home_recent_opened", { kind });
    },
  };
};

const Home = ({ onAsk, onContinue, onOpenPage }: HomeProps) => {
  const programCount = useProgramCount();
  const start = useStart(onContinue);
  const [tutorialError, setTutorialError] = useState<
    TutorialFailure | undefined
  >(undefined);

  const openTile = (tile: HomeTile) => {
    homeTelemetry.track("home_tile_opened", { tile });
    onOpenPage(tile);
  };

  return (
    <BaseHome
      start={start}
      // The start offers only its ladder, one tutorial per level
      tutorials={startTutorials(PgTutorial.all)}
      programCount={programCount}
      onTile={openTile}
      tutorialError={tutorialError}
      onTutorial={async (name) => {
        setTutorialError(undefined);
        try {
          await PgTutorial.open(name);
        } catch (e) {
          // Told to the user on the card and logged once here, so the
          // button's own `onError` never sees it
          log.error(e, { report: true, context: { tutorial: name } });
          setTutorialError({
            name,
            message: errorMessage(e, "Could not open tutorial"),
          });
          return;
        }
        homeTelemetry.track("home_tutorial_opened", {});
      }}
      onAllTutorials={() => onOpenPage("tutorials")}
      onAsk={() => {
        homeTelemetry.track("home_composer_opened", {});
        onAsk();
      }}
    />
  );
};

export default Home;
