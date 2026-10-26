import { createTracker } from "@/shared/lib/telemetry";

/** The two pages the catalog shows */
export type CatalogPage = "tutorials" | "programs";
/** What opened a page: the navigation, Home's tiles, or a `/tutorials` or `/programs` link */
export type CatalogVia = "nav" | "home" | "link";

type CatalogEvents = {
  /** A page was shown, or the other page replaced it; `via` is what opened it */
  catalog_shown: { page: CatalogPage; via: CatalogVia };
  /**
   * Typing in a page's search field rested for 500 ms on a non-empty query;
   * `empty` when no card matches it
   */
  catalog_searched: { page: CatalogPage; empty: boolean };
  /** A card's Open finished: the tutorial opened, or the program was imported */
  catalog_item_opened: { page: CatalogPage };
  /**
   * A card's Open failed; the card says so and the error was logged. A
   * cancelled import is not a failure.
   */
  catalog_open_failed: { page: CatalogPage };
  /** In New project, the user picked the other list; `tab` is the one now shown */
  catalog_tab_switched: { tab: CatalogPage };
};

export const catalogTelemetry = createTracker<CatalogEvents>();
