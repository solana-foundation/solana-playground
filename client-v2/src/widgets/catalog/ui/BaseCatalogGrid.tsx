import { ChevronRight } from "lucide-react";

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
import { Button } from "@/shared/ui/button";
import { Empty, EmptyDescription } from "@/shared/ui/empty";

/** One fact on a card's eyebrow: a level, a framework, a category */
export interface CatalogTag {
  label: string;
}

/** One card: a tutorial or a program, as the catalog draws it */
export interface CatalogCard {
  /** What `onOpen` gets back: a tutorial's name, a program's repo */
  id: string;
  title: string;
  description: string;
  /** The thumbnail or icon */
  media: string;
  tags: CatalogTag[];
  /** This card's Open, while it runs or once it failed; none otherwise */
  open?: CardOpen;
}

/** A card's Open: running, with what it is doing, or failed, with why */
export type CardOpen =
  | { state: "running"; text?: string }
  | { state: "failed"; message: string };

/** The list behind the cards: still loading, read, or not readable */
export type CatalogList<C = CatalogCard> =
  | { state: "loading" }
  | { state: "ready"; cards: C[] }
  | { state: "failed"; message: string; onRetry: () => void };

export interface BaseCatalogGridProps {
  /** The list's things, plural and lowercase: "tutorials", "programs" */
  label: string;
  query: string;
  /** The cards matching `query`, once the list is read */
  list: CatalogList;
  /** An Open runs: every card's Open and title wait for it */
  busy: boolean;
  /**
   * Open the card's item. Settles when the Open is over; a failure comes
   * back as the card's `open`, so this never rejects for one
   */
  onOpen: (id: string) => Promise<void>;
}

/**
 * The catalog's cards, as the Tutorials and Programs pages and New project's
 * Programs tab draw them (New project's tutorials are `BaseTutorialGrid`): two columns from 720 px, one below. Below 768 px the card's own
 * Open is hidden (`ActionCardAction`), the whole card opens through its
 * title, and a chevron at its end says so. One Open at a time: while one
 * runs (`busy`) every card's Open and title are disabled.
 */
const BaseCatalogGrid = ({
  label,
  query,
  list,
  busy,
  onOpen,
}: BaseCatalogGridProps) => {
  if (list.state === "failed") {
    return (
      <div role="alert" className="flex items-center gap-3 text-control">
        <span className="text-error">{list.message}</span>
        <Button variant="outline" onClick={list.onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (list.state === "loading") {
    return (
      <p className="text-control text-muted-foreground">{`Loading ${label}…`}</p>
    );
  }
  if (list.cards.length === 0) {
    return (
      <Empty className="p-0">
        <EmptyDescription>{`No ${label} match “${query}”.`}</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2">
      {list.cards.map((c) => (
        <ActionCard key={c.id}>
          <ActionCardMedia variant="image">
            <img src={c.media} alt="" />
          </ActionCardMedia>
          <ActionCardContent>
            {/* Plain text, as the prototype writes it: level · framework, or
                framework · first category */}
            <ActionCardEyebrow>
              {c.tags.map((t) => t.label).join(" · ")}
            </ActionCardEyebrow>
            <ActionCardTitle>
              <ActionCardLink asChild>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    onOpen(c.id).catch(reportButtonFailure(`open ${c.title}`))
                  }
                >
                  {c.title}
                </button>
              </ActionCardLink>
            </ActionCardTitle>
            <ActionCardDescription>{c.description}</ActionCardDescription>
            {c.open?.state === "running" && c.open.text ? (
              <p className="text-caption text-muted-foreground">
                {c.open.text}
              </p>
            ) : null}
            {c.open?.state === "failed" ? (
              <p role="alert" className="text-caption text-error">
                {c.open.message}
              </p>
            ) : null}
          </ActionCardContent>
          <ActionCardAction>
            <AsyncButton
              type="button"
              variant="outline"
              aria-label={`Open ${c.title}`}
              disabled={busy}
              onClick={() => onOpen(c.id)}
              onError={reportButtonFailure(`open ${c.title}`)}
            >
              Open
            </AsyncButton>
          </ActionCardAction>
          <ChevronRight
            data-card-chevron
            aria-hidden="true"
            className="size-4 shrink-0 self-center text-muted-foreground md:hidden"
          />
        </ActionCard>
      ))}
    </div>
  );
};

export default BaseCatalogGrid;
