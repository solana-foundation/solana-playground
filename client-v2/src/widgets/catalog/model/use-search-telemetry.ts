import { useEffect, useRef } from "react";

import { catalogTelemetry } from "./telemetry";
import type { CatalogPage } from "./telemetry";

/** How long typing rests before a query counts as searched */
export const SEARCH_REST_MS = 500;

/**
 * Sends `catalog_searched` once typing has rested on a non-empty query, so a
 * word typed key by key is one search, and a field cleared is none. `empty`
 * is read when the rest ends, so a list that loaded meanwhile counts.
 */
export const useSearchTelemetry = (
  page: CatalogPage,
  query: string,
  empty: boolean
) => {
  const emptyNow = useRef(empty);
  emptyNow.current = empty;

  useEffect(() => {
    if (!query.trim()) return;
    const timer = window.setTimeout(
      () =>
        catalogTelemetry.track("catalog_searched", {
          page,
          empty: emptyNow.current,
        }),
      SEARCH_REST_MS
    );
    return () => window.clearTimeout(timer);
  }, [page, query]);
};
