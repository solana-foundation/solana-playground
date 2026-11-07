import type { CatalogPage } from "@/widgets/catalog";
import { catalogPage } from "@/widgets/catalog";

import { handleRoute } from "./common";

/**
 * A link to the Tutorials or Programs page, or the page's own path come back
 * to by Back or Forward: show the page, and mount the work (or Home, with no
 * project open) under it, as `/` does. The path stays in the address bar
 * while the page shows; `useViewPath` (views/flow) moves it on when the page
 * closes.
 */
export const openPageFromLink = (page: CatalogPage) => {
  catalogPage.open(page, "link");
  return handleRoute();
};
