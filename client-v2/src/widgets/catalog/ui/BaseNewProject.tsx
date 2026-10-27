import type { ReactNode } from "react";

import {
  Segmented,
  SegmentedCount,
  SegmentedItem,
} from "@/shared/ui/segmented";
import type { ListCount } from "../model/lists";
import type { CatalogPage } from "../model/telemetry";
import BaseCatalogGrid from "./BaseCatalogGrid";
import type { BaseCatalogGridProps } from "./BaseCatalogGrid";
import BaseTutorialGrid from "./BaseTutorialGrid";
import type { BaseTutorialGridProps } from "./BaseTutorialGrid";
import CatalogSearch from "./CatalogSearch";

export interface BaseNewProjectProps {
  /** Start from scratch, drawn above the lists */
  scratch: ReactNode;
  tab: CatalogPage;
  onTab: (tab: CatalogPage) => void;
  counts: Record<CatalogPage, ListCount>;
  query: string;
  onQuery: (query: string) => void;
  /** The tutorials, drawn on the Tutorials tab */
  tutorials: Omit<BaseTutorialGridProps, "query">;
  /** The programs' cards, drawn on the Programs tab */
  grid: Omit<BaseCatalogGridProps, "label" | "query">;
}

const COUNT_TEXT: Record<"loading" | "failed", string> = {
  loading: "…",
  failed: "?",
};

const countText = (count: ListCount) =>
  typeof count === "number" ? String(count) : COUNT_TEXT[count];

const TABS: { value: CatalogPage; label: string }[] = [
  { value: "tutorials", label: "Tutorials" },
  { value: "programs", label: "Programs" },
];

/**
 * The prototype's "What do you want to build?": start from scratch, then
 * Tutorials and Programs as one choice with a count each beside the search
 * field, then the chosen list's cards. The dialog around it is the caller's.
 */
const BaseNewProject = ({
  scratch,
  tab,
  onTab,
  counts,
  query,
  onQuery,
  tutorials,
  grid,
}: BaseNewProjectProps) => (
  <div data-gallery-modal className="flex flex-col gap-4">
    <p className="text-control font-read text-muted-foreground">
      Start clean, open a real program, or learn through a tutorial. Everything
      stays in this browser until you deploy.
    </p>

    {scratch}

    <div className="flex flex-wrap items-center gap-3">
      <Segmented
        variant="boxed"
        aria-label="Gallery source"
        value={tab}
        onValueChange={(next) => {
          // A press on the chosen item clears the group; keep the choice
          if (next) onTab(next as CatalogPage);
        }}
        className="max-md:w-full"
      >
        {TABS.map((t) => (
          <SegmentedItem
            key={t.value}
            value={t.value}
            className="max-md:flex-1"
          >
            {t.label}
            <SegmentedCount>{countText(counts[t.value])}</SegmentedCount>
          </SegmentedItem>
        ))}
      </Segmented>
      <CatalogSearch
        label={tab}
        query={query}
        onQuery={onQuery}
        icon={false}
        className="min-w-40 flex-1 max-w-none"
      />
    </div>

    {tab === "tutorials" ? (
      <BaseTutorialGrid query={query} {...tutorials} />
    ) : (
      <BaseCatalogGrid label={tab} query={query} {...grid} />
    )}

    {/* Sticks to the foot of the dialog's scroll area while the list runs
        past it, so a cut-off card reads as "more below". Scrolled to the
        end, it lays its height less the column's gap (8 px) over the last
        row's bottom padding, never over its content */}
    <div
      data-scroll-fade
      aria-hidden="true"
      className="pointer-events-none sticky bottom-0 -mt-6 h-6 shrink-0 bg-gradient-to-t from-surface-panel to-transparent"
    />
  </div>
);

export default BaseNewProject;
