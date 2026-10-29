import type { CardOpen, CatalogCard, CatalogList } from "../ui/BaseCatalogGrid";

/** A list's size, or where reading it stands */
export type ListCount = number | "loading" | "failed";

/** A card's Open, by its id: `useCardOpen`'s `cardOpen` */
export type CardOpenOf = (id: string) => CardOpen | undefined;

/**
 * One list of the catalog: the cards for a query, and how many the whole
 * list holds. The count follows the list's state, so the two cannot disagree
 */
export type CardList<C = CatalogCard> =
  | { list: Extract<CatalogList<C>, { state: "loading" }>; count: "loading" }
  | { list: Extract<CatalogList<C>, { state: "ready" }>; count: number }
  | { list: Extract<CatalogList<C>, { state: "failed" }>; count: "failed" };
