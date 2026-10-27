import { ArrowUpRight, Check, ChevronRight } from "lucide-react";

import type { TutorialProgress } from "@/entities/tutorial";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import {
  ActionCard,
  ActionCardContent,
  ActionCardDescription,
  ActionCardLink,
  ActionCardMedia,
  ActionCardTitle,
} from "@/shared/ui/action-card";
import TutorialCover from "./art/TutorialCover";
import type { CardOpen } from "./BaseCatalogGrid";

export interface BaseTutorialCardProps {
  title: string;
  description: string;
  /** The line under the description: `tutorialCaption` */
  caption: string;
  /** Picks the cover's ground */
  framework?: FrameworkName;
  progress: TutorialProgress;
  /** This card's Open, while it runs or once it failed; none otherwise */
  open?: CardOpen;
  /** An Open runs: this card waits for it */
  busy: boolean;
  /**
   * Open the tutorial. Settles when the Open is over; a failure comes back
   * as `open`, so this never rejects for one
   */
  onOpen: () => Promise<void>;
}

/** What the card's one button says, by how far the user is */
const label = (title: string, progress: TutorialProgress): string => {
  if (progress.state === "completed") return `${title} completed. Open it`;
  if (progress.state === "started") return `Continue ${title}`;
  return `Open ${title}`;
};

/**
 * A tutorial as the stand draws it: the brand cover, the name with the page
 * the user is on once started, the description, a caption, and a corner
 * square that says what a press does (↗ to open, a tick once completed).
 * The card has one button, stretched over the whole card, so the square
 * only draws it. Below 768 px the square gives way to a chevron (a completed
 * tutorial keeps its tick); the button and its name stay.
 */
const BaseTutorialCard = ({
  title,
  description,
  caption,
  framework,
  progress,
  open,
  busy,
  onOpen,
}: BaseTutorialCardProps) => {
  const completed = progress.state === "completed";
  return (
    <ActionCard className="gap-3.5">
      <ActionCardMedia variant="image">
        <TutorialCover name={title} framework={framework} />
      </ActionCardMedia>
      <ActionCardContent>
        <div className="flex min-w-0 items-baseline gap-2">
          <ActionCardTitle className="min-w-0">{title}</ActionCardTitle>
          {progress.state === "started" ? (
            <span className="ml-auto shrink-0 text-caption text-muted-foreground tabular-nums">
              {`${progress.page} of ${progress.pages}`}
            </span>
          ) : null}
        </div>
        <ActionCardDescription>{description}</ActionCardDescription>
        {caption ? (
          <p className="mt-1.5 text-caption text-subtle tabular-nums">
            {caption}
          </p>
        ) : null}
        {open?.state === "running" && open.text ? (
          <p className="text-caption text-muted-foreground">{open.text}</p>
        ) : null}
        {open?.state === "failed" ? (
          <p role="alert" className="text-caption text-error">
            {open.message}
          </p>
        ) : null}
      </ActionCardContent>
      <ActionCardLink asChild>
        <button
          type="button"
          aria-label={label(title, progress)}
          disabled={busy}
          onClick={() => onOpen().catch(reportButtonFailure(`open ${title}`))}
          className="static shrink-0 self-start max-md:self-center"
        >
          <span
            data-card-corner
            className={cn(
              "grid size-8 place-items-center rounded-lg",
              completed
                ? "text-success md:bg-success/12"
                : "bg-surface-raised text-foreground max-md:hidden"
            )}
          >
            {completed ? (
              <Check data-card-tick aria-hidden="true" className="size-4" />
            ) : (
              <ArrowUpRight aria-hidden="true" className="size-4" />
            )}
          </span>
          {completed ? null : (
            <ChevronRight
              data-card-chevron
              aria-hidden="true"
              className="size-4 text-muted-foreground md:hidden"
            />
          )}
        </button>
      </ActionCardLink>
    </ActionCard>
  );
};

export default BaseTutorialCard;
