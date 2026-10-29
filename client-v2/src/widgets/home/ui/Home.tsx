import { useState } from "react";

import { PgSession } from "@/features/auth";
import { StartFromScratch } from "@/features/new-project";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgTutorial } from "@/utils";
import { errorMessage } from "../lib/error-message";
import { runExample } from "../model/example";
import { recentProjects } from "../model/recent";
import { useSessionRetry } from "../model/session-retry";
import { useVisit } from "../model/use-visit";
import { needsSessionRetry } from "../model/visit";
import type { RecentEntry } from "../model/recent";
import { useProgramCount } from "../model/use-program-count";
import { homeTelemetry } from "../model/telemetry";
import type { PageTile } from "../model/telemetry";
import BaseHome from "./BaseHome";
import type { HomeStart, TutorialFailure } from "./BaseHome";

export interface HomeProps {
  onAsk: () => void;
  /** Go back to the project open under Home */
  onContinue: () => void;
  /** Open the Tutorials or Programs page, in Home's place */
  onOpenPage: (page: PageTile) => void;
}

const log = createLogger("home:actions");

/**
 * Open a recent row. The open project is still under Home, so it goes back
 * to it, never re-reading it under a live editor; a started tutorial opens
 * through `PgTutorial.open`, which restores its route and page.
 */
const openRecent = async (entry: RecentEntry, onContinue: () => void) => {
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
const useStart = (onContinue: () => void): HomeStart | null => {
  const visit = useVisit();
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
  if (visit === "unknown" || !names) return null;
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
    entries: recentProjects(names, PgExplorer.currentWorkspaceName, (name) =>
      PgTutorial.isWorkspaceTutorial(name)
    ),
    onOpen: async (entry) => {
      const kind = await openRecent(entry, onContinue);
      homeTelemetry.track("home_recent_opened", { kind });
    },
  };
};

const Home = ({ onAsk, onContinue, onOpenPage }: HomeProps) => {
  const programCount = useProgramCount();
  const start = useStart(onContinue);
  const [tutorialError, setTutorialError] = useState<TutorialFailure | null>(
    null
  );

  const openTile = (tile: PageTile) => {
    homeTelemetry.track("home_tile_opened", { tile });
    onOpenPage(tile);
  };

  return (
    <BaseHome
      start={start}
      tutorials={PgTutorial.all}
      programCount={programCount}
      scratch={<StartFromScratch />}
      onTile={openTile}
      onNewProject={() =>
        homeTelemetry.track("home_tile_opened", { tile: "new-project" })
      }
      tutorialError={tutorialError}
      onTutorial={async (name) => {
        setTutorialError(null);
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
