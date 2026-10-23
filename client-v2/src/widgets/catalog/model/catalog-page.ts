import { useEffect, useSyncExternalStore } from "react";

import { isTutorialRoutePath } from "@/routes/catalog-paths";
import { PgRouter } from "@/utils";
import type { Disposable } from "@/utils/types";
import { catalogTelemetry } from "./telemetry";
import type { CatalogPage, CatalogVia } from "./telemetry";

type Listener = (page: CatalogPage | null) => void;

let current: CatalogPage | null = null;
const listeners = new Set<Listener>();

const set = (next: CatalogPage | null) => {
  if (current === next) return;
  current = next;
  listeners.forEach((cb) => cb(next));
};

/**
 * The page the catalog shows, if any. One per app: the navigation, Home and
 * the link routes open it; what closes it is listed at `useCatalogPage`.
 */
export const catalogPage = {
  current: (): CatalogPage | null => current,
  /** Show `page`; reported only when the page shown changes */
  open: (page: CatalogPage, via: CatalogVia) => {
    if (current === page) return;
    set(page);
    catalogTelemetry.track("catalog_shown", { page, via });
  },
  close: () => set(null),
  onDidChange: (cb: Listener): Disposable => {
    listeners.add(cb);
    return { dispose: () => listeners.delete(cb) };
  },
};

const subscribe = (cb: () => void) => {
  const sub = catalogPage.onDidChange(cb);
  return () => sub.dispose();
};

/**
 * The page shown, for rendering. While mounted it also closes the page when
 * a tutorial's route opens. Not on `/`, which the link routes go to after
 * opening their page.
 *
 * The page closes only on what the user picks: a card's Open finishing
 * (`useCardOpen`), a tutorial's route, a project in the list (`onPicked`),
 * New project or Home in the navigation (`AppNav`), and the product asking
 * for the assistant, which is under the page (`LayoutShell`'s `cover`). The
 * explorer's own events close nothing: it switches to the open project on
 * every route's init, and sync switches and creates projects in the
 * background.
 */
export const useCatalogPage = (): CatalogPage | null => {
  const page = useSyncExternalStore(subscribe, catalogPage.current);

  useEffect(() => {
    const sub = PgRouter.onDidChangePath((path) => {
      if (isTutorialRoutePath(path)) catalogPage.close();
    });
    return () => sub.dispose();
  }, []);

  return page;
};
