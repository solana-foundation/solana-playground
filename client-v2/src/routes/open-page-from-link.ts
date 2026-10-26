import { createElement } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgRouter, PgView } from "@/utils";
import { catalogPage } from "@/widgets/catalog";
import type { CatalogPage } from "@/widgets/catalog";

const log = createLogger("catalog:link");

/**
 * A link to the Tutorials or Programs page: show the page, then replace the
 * link with `/`, whose route opens the work (or Home) under it. Replaced,
 * not pushed: Back would land on the link, which pushes `/` again, and the
 * user could never go back past it. What closes the page afterwards is
 * `useCatalogPage`'s to say.
 */
export const openPageFromLink = (page: CatalogPage) => {
  catalogPage.open(page, "link");
  PgRouter.navigate("/", { replace: true }).catch((e: unknown) => {
    // The page would stand over a frame whose route never ran
    log.error(e, { report: true, context: { page } });
    catalogPage.close();
    PgView.setToast(
      () =>
        createElement(
          "span",
          null,
          "Could not open the page. Reload to try again."
        ),
      { options: { name: "catalog-link-failed" } }
    );
  });
};
