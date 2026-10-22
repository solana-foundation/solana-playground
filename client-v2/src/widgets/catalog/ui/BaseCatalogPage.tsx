import BaseCatalogGrid from "./BaseCatalogGrid";
import type { CatalogList } from "./BaseCatalogGrid";
import CatalogSearch from "./CatalogSearch";

export type {
  CardOpen,
  CatalogCard,
  CatalogList,
  CatalogTag,
} from "./BaseCatalogGrid";

export interface BaseCatalogPageProps {
  /** The page's things, plural and lowercase: "tutorials", "programs" */
  label: string;
  query: string;
  onQuery: (query: string) => void;
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
 * A page of cards with a search field over them, as the prototype draws
 * Tutorials and Programs; `BaseCatalogGrid` draws the cards.
 */
const BaseCatalogPage = ({
  label,
  query,
  onQuery,
  list,
  busy,
  onOpen,
}: BaseCatalogPageProps) => (
  <section className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 py-8">
    <CatalogSearch label={label} query={query} onQuery={onQuery} />
    <BaseCatalogGrid
      label={label}
      query={query}
      list={list}
      busy={busy}
      onOpen={onOpen}
    />
  </section>
);

export default BaseCatalogPage;
