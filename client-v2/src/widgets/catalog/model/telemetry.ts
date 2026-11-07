import { createTracker } from "@/shared/lib/telemetry";

/** The catalog's two lists, each a page of its own and a tab in New project */
export type CatalogPage = "tutorials" | "programs";
/** Every page the catalog shows: the two lists and New project */
export type ShownPage = CatalogPage | "new-project";
/**
 * What opened a page: the navigation, Home's tiles, a `/new`, `/tutorials`
 * or `/programs` link, the lesson band's Browse gallery, or the empty
 * editor's Start a project
 */
export type CatalogVia = "nav" | "home" | "link" | "lesson" | "editor";

type CatalogEvents = {
  /**
   * A page was shown, or another page replaced it; `page` is one of the three
   * and `via` what opened it (`CatalogVia`)
   */
  catalog_shown: { page: ShownPage; via: CatalogVia };
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
