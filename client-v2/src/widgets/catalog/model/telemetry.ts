import { createTracker } from "@/shared/lib/telemetry";

import type { FrameworkFilter } from "../lib/levels";
import type { BannerState } from "./banner";

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
  /** The Tutorials page's framework filter changed; `framework` is the one now picked */
  catalog_filtered: { page: "tutorials"; framework: FrameworkFilter };
  /**
   * The Start here banner's action opened its tutorial; `state` is what the
   * banner said: not started, started, or every start tutorial completed
   */
  catalog_banner_opened: { state: BannerState };
  /** In New project, the user picked the other list; `tab` is the one now shown */
  catalog_tab_switched: { tab: CatalogPage };
};

export const catalogTelemetry = createTracker<CatalogEvents>();
