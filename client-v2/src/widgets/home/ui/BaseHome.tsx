import {
  ChevronRight,
  FlaskConical,
  Folder,
  GraduationCap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import type { TutorialProgress } from "@/entities/tutorial";
import { TutorialCover } from "@/entities/tutorial";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import {
  ActionCard,
  ActionCardAction,
  ActionCardContent,
  ActionCardDescription,
  ActionCardEyebrow,
  ActionCardGroup,
  ActionCardLink,
  ActionCardMedia,
  ActionCardTitle,
} from "@/shared/ui/action-card";
import { AsyncButton } from "@/shared/ui/async-button";
import { Badge } from "@/shared/ui/badge";
import { BrandButton, BrandButtonIcon } from "@/shared/ui/brand-button";
import { BrandIcon } from "@/shared/ui/brand-icon";
import { Button } from "@/shared/ui/button";
import type { TutorialData } from "@/utils";

import type { RecentEntry } from "../model/recent";
import type { HomeTile } from "../model/telemetry";
import HomeComposer from "./HomeComposer";

/** What a tutorial's card shows: the tutorial model's own fields */
export type HomeTutorial = Pick<
  TutorialData,
  "name" | "description" | "level" | "framework"
>;

/** Why a tutorial failed to open, shown on that tutorial's card */
export interface TutorialFailure {
  name: string;
  message: string;
}

/** The example's one line (spec `client-v2-first-run`) */
const EXAMPLE_LINE =
  "This program saves a number in an account and writes it to the logs.";

/**
 * What leads Home, by visit: the example on a first one, recent work on a
 * return one. Each rejection is the button's to report.
 */
export type HomeStart =
  | { kind: "example"; onRun: () => Promise<void> }
  | { kind: "retry"; onRetry: () => Promise<void> }
  | {
      kind: "recent";
      entries: readonly RecentEntry[];
      /** How far a tutorial row has got, for its line under the name */
      progressOf: (name: string) => TutorialProgress;
      onOpen: (entry: RecentEntry) => Promise<void>;
    };

export interface BaseHomeProps {
  /**
   * `undefined` while the visit is unknown (the project list or the session not
   * read, a signed-in account's list not read, or a failed read still inside
   * its automatic re-reads; see `visitOf`); `retry` once those are spent
   */
  start: HomeStart | undefined;
  /** All of them: the first four are shown, the tiles count them all */
  tutorials: readonly HomeTutorial[];
  /** `null` while loading */
  programCount: number | null;
  onTile: (tile: HomeTile) => void;
  onTutorial: (name: string) => Promise<void>;
  /** The last tutorial that failed to open, or `undefined` */
  tutorialError: TutorialFailure | undefined;
  onAllTutorials: () => void;
  onAsk: () => void;
}

const SHOWN_TUTORIALS = 4;

/**
 * "Run it", the view's one brand action. Not an `AsyncButton`, which wraps
 * `Button`: the brand look needs `BrandButton`, which has no busy state, so
 * the busy flag is kept here and a second press while the first runs does
 * nothing.
 */
const RunButton = ({ onRun }: { onRun: () => Promise<void> }) => {
  const [running, setRunning] = useState(false);
  return (
    <BrandButton
      disabled={running}
      aria-busy={running || undefined}
      onClick={() => {
        setRunning(true);
        // Through `then`, so a synchronous throw is caught as well
        Promise.resolve()
          .then(onRun)
          .catch(reportButtonFailure("open the example"))
          .finally(() => setRunning(false));
      }}
    >
      Run it
      <BrandButtonIcon />
    </BrandButton>
  );
};

const Example = ({ onRun }: { onRun: () => Promise<void> }) => (
  <section aria-label="Try an example">
    {/* The phone's flask tile, so the entry looks the same on both, and a
        faint green from the left to set it apart from the cards below */}
    <ActionCard className="items-center bg-linear-to-r from-brand-green/5 to-transparent to-45%">
      <ActionCardMedia className="bg-brand-green/15 text-brand-green">
        <FlaskConical aria-hidden="true" />
      </ActionCardMedia>
      <ActionCardContent>
        {/* Two lines, a title and its line: the title says what to do, so
            no eyebrow above it */}
        <ActionCardTitle>Try the Anchor starter</ActionCardTitle>
        <ActionCardDescription>{EXAMPLE_LINE}</ActionCardDescription>
      </ActionCardContent>
      {/* Not `ActionCardAction`, which hides below md: here the button is
          the only way in */}
      <div className="relative z-10 ml-auto shrink-0 self-center">
        <RunButton onRun={onRun} />
      </div>
    </ActionCard>
  </section>
);

/**
 * What Home leads with when the account check keeps failing. Our copy: the
 * designers' Spec 08 has no row for a failed account check.
 */
export const RetryLine = ({ onRetry }: { onRetry: () => Promise<void> }) => (
  <div
    role="status"
    className="flex items-center justify-between gap-3 text-caption text-muted-foreground"
  >
    <span>We could not check your account.</span>
    <AsyncButton
      variant="outline"
      size="sm"
      onClick={onRetry}
      onError={reportButtonFailure("check your account")}
    >
      Try again
    </AsyncButton>
  </div>
);

/** A row's tile: what it is, in the phone's tints */
const RECENT_TILE: Record<
  RecentEntry["kind"],
  { icon: ReactNode; tint?: string }
> = {
  project: { icon: <Folder aria-hidden="true" /> },
  tutorial: {
    icon: <GraduationCap aria-hidden="true" />,
    tint: "bg-brand-purple/15 text-brand-purple",
  },
};

/** The line under a row's name: what it is, and a tutorial's page as the project list writes it */
const recentMeta = (entry: RecentEntry, progress: TutorialProgress) => {
  if (entry.kind === "project") return "Project";
  if (progress.state === "started") {
    return `Tutorial · ${progress.page} of ${progress.pages}`;
  }
  if (progress.state === "completed") return "Tutorial · Completed";
  return "Tutorial";
};

/**
 * One list in one frame: three rows take less height than three cards, so
 * the composer stays above the fold
 */
const Recent = ({
  entries,
  progressOf,
  onOpen,
}: {
  entries: readonly RecentEntry[];
  progressOf: (name: string) => TutorialProgress;
  onOpen: (entry: RecentEntry) => Promise<void>;
}) => (
  <section aria-labelledby="home-recent" className="flex flex-col gap-2">
    <h2 id="home-recent" className="text-caption text-muted-foreground">
      Pick up where you left off
    </h2>
    <ActionCardGroup>
      {entries.map((entry) => (
        <li key={entry.name}>
          <ActionCard>
            <ActionCardMedia className={RECENT_TILE[entry.kind].tint}>
              {RECENT_TILE[entry.kind].icon}
            </ActionCardMedia>
            <ActionCardContent>
              <ActionCardTitle>
                {/* The whole row is the one target */}
                <ActionCardLink asChild>
                  <button
                    type="button"
                    aria-label={`Open ${entry.name}`}
                    onClick={() => {
                      Promise.resolve()
                        .then(() => onOpen(entry))
                        .catch(reportButtonFailure(`open ${entry.name}`));
                    }}
                  >
                    {entry.name}
                  </button>
                </ActionCardLink>
              </ActionCardTitle>
              <ActionCardDescription>
                {recentMeta(entry, progressOf(entry.name))}
              </ActionCardDescription>
            </ActionCardContent>
            {entry.current && <Badge variant="secondary">Open now</Badge>}
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </ActionCard>
        </li>
      ))}
    </ActionCardGroup>
  </section>
);

const BaseHome = ({
  start,
  tutorials,
  programCount,
  onTile,
  onTutorial,
  tutorialError,
  onAllTutorials,
  onAsk,
}: BaseHomeProps) => {
  const tutorialCount = tutorials.length;

  return (
    <section
      aria-label="Home"
      className="mx-auto flex w-full max-w-[50rem] flex-col gap-5 px-8 pt-20 pb-16"
    >
      <h1 className="text-center font-heading text-display font-headline text-foreground">
        Where should we begin?
      </h1>
      {/* Above the composer, so Tab reaches "Run it" first (spec
          `client-v2-first-run`) */}
      {start?.kind === "example" && <Example onRun={start.onRun} />}
      {start?.kind === "retry" && <RetryLine onRetry={start.onRetry} />}
      {start?.kind === "recent" && (
        <Recent
          entries={start.entries}
          progressOf={start.progressOf}
          onOpen={start.onOpen}
        />
      )}
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
                <button type="button" onClick={() => onTile("new-project")}>
                  New project
                </button>
              </ActionCardLink>
            </ActionCardTitle>
            <ActionCardDescription>Anchor or Native</ActionCardDescription>
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
            <ActionCardMedia variant="image" className="h-14">
              <TutorialCover name={t.name} framework={t.framework} />
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
