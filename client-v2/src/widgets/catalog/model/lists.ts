import type { CardOpen, CatalogCard } from "../ui/BaseCatalogGrid";

/** A list's size, or where reading it stands */
export type ListCount = number | "loading" | "failed";

/** A card's Open, by its id: `useCardOpen`'s `cardOpen` */
export type CardOpenOf = (id: string) => CardOpen | undefined;

/**
 * One list of the catalog: the cards for a query, and how many the whole
 * list holds. The count follows the list's state, so the two cannot disagree
 */
export type CardList =
  | { list: { state: "loading" }; count: "loading" }
  | { list: { state: "ready"; cards: CatalogCard[] }; count: number }
  | {
      list: { state: "failed"; message: string; onRetry: () => void };
      count: "failed";
    };
