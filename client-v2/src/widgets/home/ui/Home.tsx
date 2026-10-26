import { useState } from "react";

import { StartFromScratch } from "@/features/new-project";
import { createLogger } from "@/shared/lib/logger";
import { PgTutorial } from "@/utils";
import { errorMessage } from "../lib/error-message";
import { useProgramCount } from "../model/use-program-count";
import { homeTelemetry } from "../model/telemetry";
import type { PageTile } from "../model/telemetry";
import BaseHome from "./BaseHome";
import type { TutorialFailure } from "./BaseHome";

export interface HomeProps {
  onAsk: () => void;
  /** Open the Tutorials or Programs page, in Home's place */
  onOpenPage: (page: PageTile) => void;
}

const log = createLogger("home:actions");

const Home = ({ onAsk, onOpenPage }: HomeProps) => {
  const programCount = useProgramCount();
  const [tutorialError, setTutorialError] = useState<TutorialFailure | null>(
    null
  );

  const openTile = (tile: PageTile) => {
    homeTelemetry.track("home_tile_opened", { tile });
    onOpenPage(tile);
  };

  return (
    <BaseHome
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
