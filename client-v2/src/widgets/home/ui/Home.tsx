import { useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgTutorial, PgView } from "@/utils";
import NewWorkspaceModal from "@/views/flow/gallery/NewWorkspaceModal";
import type { GalleryTab } from "@/views/flow/gallery/NewWorkspaceModal";
import StartFromScratch from "@/views/flow/gallery/StartFromScratch";
import { errorMessage } from "../lib/error-message";
import { useProgramCount } from "../model/use-program-count";
import { homeTelemetry } from "../model/telemetry";
import type { GalleryTile } from "../model/telemetry";
import BaseHome from "./BaseHome";
import type { TutorialFailure } from "./BaseHome";

export interface HomeProps {
  onAsk: () => void;
}

const log = createLogger("home:actions");

const Home = ({ onAsk }: HomeProps) => {
  const programCount = useProgramCount();
  const [tutorialError, setTutorialError] = useState<TutorialFailure | null>(
    null
  );

  const openGallery = (initialTab: GalleryTab) => {
    // Settles when the modal closes and never rejects: a gallery that fails
    // to render is reported and told by `ModalHost`'s boundary
    void PgView.setModal<unknown, { initialTab: GalleryTab }>(
      NewWorkspaceModal,
      { initialTab }
    );
  };

  const openTile = (tile: GalleryTile) => {
    homeTelemetry.track("home_tile_opened", { tile });
    openGallery(tile);
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
      onAllTutorials={() => openGallery("tutorials")}
      onAsk={() => {
        homeTelemetry.track("home_composer_opened", {});
        onAsk();
      }}
    />
  );
};

export default Home;
