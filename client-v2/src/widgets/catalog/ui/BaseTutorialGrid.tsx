import { Button } from "@/shared/ui/button";

import { tutorialCaption } from "../lib/tutorial-caption";
import type { TutorialItem } from "../model/use-tutorial-list";
import type { CatalogList } from "./BaseCatalogGrid";
import BaseNoMatch from "./BaseNoMatch";
import BaseTutorialCard from "./BaseTutorialCard";

export interface BaseTutorialGridProps {
  query: string;
  /** Empties the search, from the no-match state's "Clear search" */
  onClear: () => void;
  /** The tutorials matching `query`, once the list is read */
  items: CatalogList<TutorialItem>;
  /** An Open runs: every card waits for it */
  busy: boolean;
  /**
   * Open the tutorial. Settles when the Open is over; a failure comes back
   * as the card's `open`, so this never rejects for one
   */
  onOpen: (id: string) => Promise<void>;
}

/**
 * Tutorials as the stand lays them out: as many columns of at least 20 rem
 * as fit, one card each (`BaseTutorialCard`), captioned with the level and
 * the framework. One Open at a time: while one runs (`busy`) every card
 * waits.
 */
const BaseTutorialGrid = ({
  query,
  onClear,
  items,
  busy,
  onOpen,
}: BaseTutorialGridProps) => {
  if (items.state === "failed") {
    return (
      <div role="alert" className="flex items-center gap-3 text-control">
        <span className="text-error">{items.message}</span>
        <Button variant="outline" onClick={items.onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (items.state === "loading") {
    return (
      <p className="text-control text-muted-foreground">Loading tutorials…</p>
    );
  }
  if (items.cards.length === 0) {
    return <BaseNoMatch label="tutorials" query={query} onClear={onClear} />;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-3">
      {items.cards.map((t) => (
        <BaseTutorialCard
          key={t.id}
          title={t.title}
          description={t.description}
          caption={tutorialCaption(t, false)}
          framework={t.framework}
          progress={t.progress}
          open={t.open}
          busy={busy}
          onOpen={() => onOpen(t.id)}
        />
      ))}
    </div>
  );
};

export default BaseTutorialGrid;
