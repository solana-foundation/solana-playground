/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { useState } from "react";

import { cn } from "@/shared/lib/utils";

import type { FrameworkFilter as Filter } from "../lib/levels";
import { resultsLine, searchHint } from "../lib/levels";
import type { Banner } from "../model/banner";
import type { TutorialItem } from "../model/use-tutorial-list";
import type { CardOpen } from "./BaseCatalogGrid";
import BaseStartHereBanner from "./BaseStartHereBanner";
import BaseTutorialLevels from "./BaseTutorialLevels";
import FoldingSearch from "./FoldingSearch";
import FrameworkFilter from "./FrameworkFilter";

export interface BaseTutorialsPageProps {
  query: string;
  onQuery: (query: string) => void;
  framework: Filter;
  onFramework: (framework: Filter) => void;
  /** Draw the filter: the list holds two or more frameworks */
  filterable: boolean;
  /** How many tutorials the page lists in all, for the search's hint */
  count: number;
  /** The tutorials matching the query and the framework */
  items: readonly TutorialItem[];
  /** The Start here banner and its Open; none when the page lists nothing */
  banner?: {
    banner: Banner;
    /** The banner's Open, while it runs or once it failed */
    open?: CardOpen;
    onOpen: () => Promise<void>;
  };
  /** An Open runs: every card and the banner wait for it */
  busy: boolean;
  onOpen: (id: string) => Promise<void>;
}

/**
 * The Tutorials page as the tutorial-v2 prototype draws it
 * (`desktop/Gallery.tsx`, `TutorialsBody`): the heading with the search and
 * the framework filter, the Start here banner while browsing or the results
 * line while searching or filtering, then the cards by level.
 */
const BaseTutorialsPage = ({
  query,
  onQuery,
  framework,
  onFramework,
  filterable,
  count,
  items,
  banner,
  busy,
  onOpen,
}: BaseTutorialsPageProps) => {
  const [searchPressed, setSearchPressed] = useState(false);
  // A query always keeps its field in sight, whatever the window's width was
  const searchOpen = searchPressed || query !== "";
  const searching = query.trim() !== "";
  const browsing = !searching && framework === "all";
  return (
    <section className="mx-auto flex w-full max-w-[50rem] flex-col gap-4 px-8 pt-14 pb-16 max-md:px-4 max-md:pt-1">
      <div className="mb-4 flex items-center gap-2 max-md:mb-1 max-md:min-h-11">
        <h1
          className={cn(
            "mr-auto font-heading text-[1.75rem] font-normal tracking-[-0.015em] text-foreground",
            searchOpen && "max-md:hidden"
          )}
        >
          Tutorials
        </h1>
        <FoldingSearch
          label="tutorials"
          placeholder={searchHint(count, framework)}
          query={query}
          onQuery={onQuery}
          open={searchOpen}
          onOpen={setSearchPressed}
        />
        {filterable && (
          <div className={cn("flex", searchOpen && "max-md:hidden")}>
            <FrameworkFilter value={framework} onChange={onFramework} />
          </div>
        )}
      </div>
      {browsing && banner ? (
        <BaseStartHereBanner
          banner={banner.banner}
          open={banner.open}
          busy={busy}
          onOpen={banner.onOpen}
        />
      ) : null}
      {/* While browsing the banner leads; the line shows only when nothing is listed */}
      {browsing && items.length > 0 ? null : (
        <p role="status" className="text-[0.8125rem] text-muted-foreground">
          {resultsLine(items.length, query, framework)}
        </p>
      )}
      <BaseTutorialLevels
        items={items}
        searching={searching}
        busy={busy}
        onOpen={onOpen}
      />
    </section>
  );
};

export default BaseTutorialsPage;
