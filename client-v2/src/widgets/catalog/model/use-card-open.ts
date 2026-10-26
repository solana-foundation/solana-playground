import { useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import type { CardOpen } from "../ui/BaseCatalogGrid";
import { catalogPage } from "./catalog-page";
import { catalogTelemetry } from "./telemetry";
import type { CatalogPage } from "./telemetry";

const log = createLogger("catalog:open");

/** The one card being opened, or the last one whose Open failed */
type Opening = { id: string; open: CardOpen };

/** How a card's item opens: `report` shows progress on the card */
type Run = (report: (text: string) => void) => Promise<void>;

export interface CardOpenOptions {
  /** A rejection that is the user's choice, such as a closed program picker */
  isCancel?: (e: unknown) => boolean;
  /** What a finished Open closes: the page by default */
  onOpened?: () => void;
  /** Hears a failed Open's message, after the card shows it */
  onFailed?: (message: string) => void;
}

/**
 * One Open at a time for a page's cards. A second Open while one runs is
 * refused, since two imports of one repository collide on its name and the
 * first to finish would close the page under the second. A finished Open is
 * counted and closes the page (`onOpened`; New project's dialog when the
 * cards sit there): the item it opened takes its place (and the lesson
 * already open changes no route that would). A failed one is logged,
 * counted and shown on its card; a cancelled one (`isCancel`) is none of
 * these.
 */
export const useCardOpen = (
  page: CatalogPage,
  {
    isCancel = () => false,
    onOpened = catalogPage.close,
    onFailed,
  }: CardOpenOptions = {}
) => {
  const [opening, setOpening] = useState<Opening | null>(null);
  // Read by a second click in the same tick, before the state has rendered
  const running = useRef(false);

  const open = async (id: string, run: Run) => {
    if (running.current) return;
    running.current = true;
    setOpening({ id, open: { state: "running" } });
    let failure: { error: unknown } | null = null;
    let cancelled = false;
    try {
      await run((text) => setOpening({ id, open: { state: "running", text } }));
    } catch (e) {
      if (isCancel(e)) cancelled = true;
      else failure = { error: e };
    } finally {
      running.current = false;
    }
    // Counted and closed outside the try: a throw from a listener there is
    // not this Open failing
    if (failure) {
      log.error(failure.error, { report: true, context: { page, id } });
      catalogTelemetry.track("catalog_open_failed", { page });
      const message =
        failure.error instanceof Error
          ? failure.error.message
          : "Could not open it";
      setOpening({ id, open: { state: "failed", message } });
      onFailed?.(message);
      return;
    }
    setOpening(null);
    if (cancelled) return;
    catalogTelemetry.track("catalog_item_opened", { page });
    try {
      onOpened();
    } catch (e) {
      // The item did open; what fails is closing what showed it
      log.error(e, { report: true, context: { page, id, after: "opened" } });
    }
  };

  return {
    open,
    busy: opening?.open.state === "running",
    /** The card's Open, if it is the one running or the last that failed */
    cardOpen: (id: string): CardOpen | undefined =>
      opening?.id === id ? opening.open : undefined,
  };
};
