import type { ShownPage } from "@/widgets/catalog";
import { catalogPage } from "@/widgets/catalog";

import { handleRoute } from "./common";

/**
 * A link to the New project, Tutorials or Programs page, or the page's own
 * path come back to by Back, Forward or a reload: show the page, and mount
 * the work (or Home, with no project open) under it, as `/` does. The path
 * stays in the address bar while the page shows, so the page is a history
 * entry of its own; `useViewPath` (app/ViewPath) moves it on when the page
 * closes.
 */
export const openPageFromLink = (page: ShownPage) => {
  catalogPage.open(page, "link");
  return handleRoute();
};
