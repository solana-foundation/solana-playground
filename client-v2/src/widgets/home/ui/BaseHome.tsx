import { useState } from "react";
import type { ReactNode } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import {
  ActionCard,
  ActionCardAction,
  ActionCardContent,
  ActionCardDescription,
  ActionCardEyebrow,
  ActionCardLink,
  ActionCardMedia,
  ActionCardTitle,
} from "@/shared/ui/action-card";
import { AsyncButton } from "@/shared/ui/async-button";
import { BrandIcon } from "@/shared/ui/brand-icon";
import { Button } from "@/shared/ui/button";
import type { TutorialData } from "@/utils";
import type { PageTile } from "../model/telemetry";
import HomeComposer from "./HomeComposer";

/** What a tutorial's card shows: the tutorial model's own fields */
export type HomeTutorial = Pick<
  TutorialData,
  "name" | "description" | "level" | "framework" | "thumbnail"
>;

/** Why a tutorial failed to open, shown on that tutorial's card */
export interface TutorialFailure {
  name: string;
  message: string;
}

export interface BaseHomeProps {
  /** All of them: the first four are shown, the tiles count them all */
  tutorials: readonly HomeTutorial[];
  /** `null` while loading */
  programCount: number | null;
  /** What New project unfolds under the tiles */
  scratch: ReactNode;
  onTile: (tile: PageTile) => void;
  /** Reported; the unfold is this component's own state */
  onNewProject: () => void;
  onTutorial: (name: string) => Promise<void>;
  /** The last tutorial that failed to open, or `null` */
  tutorialError: TutorialFailure | null;
  onAllTutorials: () => void;
  onAsk: () => void;
}

const SHOWN_TUTORIALS = 4;

const BaseHome = ({
  tutorials,
  programCount,
  scratch,
  onTile,
  onNewProject,
  onTutorial,
  tutorialError,
  onAllTutorials,
  onAsk,
}: BaseHomeProps) => {
  const [unfolded, setUnfolded] = useState(false);
  const tutorialCount = tutorials.length;

  return (
    <section
      aria-label="Home"
      className="mx-auto flex w-full max-w-[50rem] flex-col gap-5 px-8 pt-20 pb-16"
    >
      <h1 className="text-center font-heading text-display font-headline text-foreground">
        Where should we begin?
      </h1>
      <HomeComposer onAsk={onAsk} />

      <div className="grid grid-cols-3 gap-3">
        <ActionCard orientation="vertical">
          {/* Each tile: the icon alone above the title, as the prototype's
              tiles draw it, and the BrandIcon the nav draws for the same
              destination */}
          <ActionCardMedia variant="glyph">
            <BrandIcon name="new" />
          </ActionCardMedia>
          <ActionCardContent>
            <ActionCardTitle>
              <ActionCardLink asChild>
                <button
                  type="button"
                  aria-expanded={unfolded}
                  onClick={() => {
                    setUnfolded(!unfolded);
                    // Only unfolding is reported, folding again is not
                    if (!unfolded) onNewProject();
                  }}
                >
                  New project
                </button>
              </ActionCardLink>
            </ActionCardTitle>
            <ActionCardDescription>
              Anchor, Native or Seahorse
            </ActionCardDescription>
          </ActionCardContent>
        </ActionCard>
        <ActionCard orientation="vertical">
          <ActionCardMedia variant="glyph">
            <BrandIcon name="tutorial" />
          </ActionCardMedia>
          <ActionCardContent>
            <ActionCardTitle>
              <ActionCardLink asChild>
                <button type="button" onClick={() => onTile("tutorials")}>
                  Follow a tutorial
                </button>
              </ActionCardLink>
            </ActionCardTitle>
            <ActionCardDescription>
              {`${tutorialCount} guided paths`}
            </ActionCardDescription>
          </ActionCardContent>
        </ActionCard>
        <ActionCard orientation="vertical">
          <ActionCardMedia variant="glyph">
            <BrandIcon name="programs" />
          </ActionCardMedia>
          <ActionCardContent>
            <ActionCardTitle>
              <ActionCardLink asChild>
                <button type="button" onClick={() => onTile("programs")}>
                  Open a program
                </button>
              </ActionCardLink>
            </ActionCardTitle>
            <ActionCardDescription>
              {`${programCount ?? "…"} real programs`}
            </ActionCardDescription>
          </ActionCardContent>
        </ActionCard>
      </div>

      {unfolded ? scratch : null}

      <div className="flex items-center justify-between">
        <p className="text-caption text-muted-foreground">
          Or learn from one of these
        </p>
        <Button variant="ghost" onClick={onAllTutorials}>
          {`All ${tutorialCount}`}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        {tutorials.slice(0, SHOWN_TUTORIALS).map((t) => (
          <ActionCard key={t.name}>
            <ActionCardMedia variant="image">
              <img src={t.thumbnail} alt="" />
            </ActionCardMedia>
            <ActionCardContent>
              {/* One plain line, as the catalog's cards write it */}
              <ActionCardEyebrow>
                {[t.level, t.framework].filter(Boolean).join(" · ")}
              </ActionCardEyebrow>
              <ActionCardTitle>
                {/* The whole card opens the tutorial, as the catalog's cards
                    do, so the card is one target */}
                <ActionCardLink asChild>
                  <button type="button" onClick={() => onTutorial(t.name)}>
                    {t.name}
                  </button>
                </ActionCardLink>
              </ActionCardTitle>
              <ActionCardDescription>{t.description}</ActionCardDescription>
              {tutorialError?.name === t.name ? (
                <p role="alert" className="text-caption text-error">
                  {tutorialError.message}
                </p>
              ) : null}
            </ActionCardContent>
            <ActionCardAction>
              <AsyncButton
                type="button"
                variant="outline"
                aria-label={`Open ${t.name}`}
                onClick={() => onTutorial(t.name)}
                onError={reportButtonFailure("open the tutorial")}
              >
                Open
              </AsyncButton>
            </ActionCardAction>
          </ActionCard>
        ))}
      </div>
    </section>
  );
};

export default BaseHome;
