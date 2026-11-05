import { ArrowUpRight, Check } from "lucide-react";

import type { TutorialProgress } from "@/entities/tutorial";
import { TutorialCover } from "@/entities/tutorial";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import {
  ActionCard,
  ActionCardContent,
  ActionCardDescription,
  ActionCardEyebrow,
  ActionCardLink,
  ActionCardMedia,
  ActionCardTitle,
} from "@/shared/ui/action-card";

import type { CardOpen } from "./BaseCatalogGrid";

export interface BaseTutorialCardProps {
  title: string;
  description: string;
  /** The word over the name: `groupedEyebrow` or `flatEyebrow` */
  eyebrow: string;
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
 * A tutorial as the tutorial-v2 prototype draws it (`desktop/TutorialList.tsx`,
 * `Card`), the same on a phone: a 44 px cover beside the word and the name,
 * the page the user is on once started, the corner square that says what a
 * press does (↗ to open, a tick once completed), and the description under
 * the word and the name. The card has one button, stretched over the whole card, so the square
 * only draws it.
 */
const BaseTutorialCard = ({
  title,
  description,
  eyebrow,
  framework,
  progress,
  open,
  busy,
  onOpen,
}: BaseTutorialCardProps) => {
  const completed = progress.state === "completed";
  return (
    <ActionCard className="grid grid-cols-[auto_minmax(0,1fr)_auto] content-start items-start gap-x-3.5 gap-y-0 rounded-panel p-4 hover:border-border hover:bg-[color-mix(in_srgb,var(--foreground)_4%,var(--surface-panel))]">
      <ActionCardMedia
        variant="image"
        className="row-span-2 size-11 rounded-[9px]"
      >
        <TutorialCover name={title} framework={framework} />
      </ActionCardMedia>
      <ActionCardContent className="gap-0">
        {eyebrow && (
          <ActionCardEyebrow className="text-[0.75rem] leading-4 text-muted-foreground">
            {eyebrow}
          </ActionCardEyebrow>
        )}
        <ActionCardTitle
          className={cn(
            "line-clamp-2 font-heading text-[1.125rem] leading-[1.25] font-normal tracking-[-0.015em]",
            eyebrow && "mt-1"
          )}
        >
          {title}
          {progress.state === "started" && (
            <span className="ml-2 align-baseline font-sans text-[0.75rem] leading-none tracking-normal text-muted-foreground tabular-nums">
              {`${progress.page} of ${progress.pages}`}
            </span>
          )}
        </ActionCardTitle>
      </ActionCardContent>
      <ActionCardLink asChild>
        <button
          type="button"
          aria-label={label(title, progress)}
          disabled={busy}
          onClick={() => onOpen().catch(reportButtonFailure(`open ${title}`))}
          className="static"
        >
          <span
            data-card-corner
            className={cn(
              "grid size-7 place-items-center rounded-lg",
              completed
                ? "bg-brand-green/12 text-brand-green"
                : "bg-foreground/[0.06] text-muted-foreground/70 transition-colors duration-100 group-hover/action-card:bg-foreground/[0.1] group-hover/action-card:text-foreground in-focus-visible:text-foreground motion-reduce:transition-none"
            )}
          >
            {completed ? (
              <Check
                data-card-tick
                strokeWidth={2.5}
                aria-hidden="true"
                className="size-4"
              />
            ) : (
              <ArrowUpRight
                strokeWidth={2.25}
                aria-hidden="true"
                className="size-4"
              />
            )}
          </span>
        </button>
      </ActionCardLink>
      <div className="col-span-2 col-start-2 mt-1.5 flex min-w-0 flex-col gap-0.5">
        <ActionCardDescription className="text-[0.8125rem] leading-[1.4] text-foreground/78">
          {description}
        </ActionCardDescription>
        {open?.state === "running" && open.text && (
          <p className="text-caption text-muted-foreground">{open.text}</p>
        )}
        {open?.state === "failed" && (
          <p role="alert" className="text-caption text-error">
            {open.message}
          </p>
        )}
      </div>
    </ActionCard>
  );
};

export default BaseTutorialCard;
