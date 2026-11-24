import { useEffect } from "react";

import { createLogger } from "../logger";
import type { Consent } from "./consent";
import { readConsent, subscribe } from "./consent";
import { expireGaCookies } from "./ga-cookies";

const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

const log = createLogger("telemetry:google-analytics");

/** Google's documented switch: while it is true on `window`, gtag.js sends nothing for the id */
const disableGa = (measurementId: string) => {
  Reflect.set(window, `ga-disable-${measurementId}`, true);
};

const enableGa = (measurementId: string) => {
  Reflect.set(window, `ga-disable-${measurementId}`, false);
};

/**
 * The queue taken off `window` by a decline, kept for a later Allow. gtag.js,
 * once loaded, drains the array it found by hooking that array's `push`, and
 * it loads once a page: a fresh array would never be read.
 */
let parkedQueue: unknown[] | undefined;

/** Takes the gtag queue off `window`, so none exists while the choice is not `allowed` */
const parkGtagQueue = () => {
  if (window.dataLayer) parkedQueue = window.dataLayer;
  delete window.gtag;
  delete window.dataLayer;
};

/** Puts a parked queue back, for `ga4Provider` to install `gtag` on at its next event */
const restoreGtagQueue = () => {
  if (parkedQueue && !window.dataLayer) window.dataLayer = parkedQueue;
  parkedQueue = undefined;
};

const injectGtag = (measurementId: string) => {
  const src = `${GTAG_SRC}?id=${encodeURIComponent(measurementId)}`;
  if (document.querySelector(`script[src="${src}"]`)) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  // Info, not a fault: blockers and filtering networks refuse gtag.js, and
  // events then wait in the queue unsent
  script.onerror = () => log.info("gtag.js did not load", { context: { src } });
  document.head.appendChild(script);
};

/**
 * Loads gtag.js for `measurementId` once the visitor allows analytics
 * (`analytics-consent`), which then drains the queue `ga4Provider` fills;
 * renders nothing. Without an id, or while the choice is not `allowed`,
 * nothing is injected.
 *
 * A choice that turns to `declined` (or `unanswered`) after gtag.js ran sets
 * `ga-disable-<id>`, which stops the script sending, and takes `gtag` and
 * `dataLayer` off `window`; an Allow after that clears the switch and puts
 * the queue back, and `ga4Provider` installs `gtag` again at the next event.
 * While the choice is `declined` or `unanswered` the `_ga` cookies are
 * expired, including those builds from before the question set without
 * asking.
 */
export const GoogleAnalytics = ({
  measurementId,
}: {
  measurementId?: string;
}) => {
  useEffect(() => {
    if (!measurementId) return;
    const apply = (choice: Consent) => {
      if (choice === "allowed") {
        enableGa(measurementId);
        restoreGtagQueue();
        injectGtag(measurementId);
        return;
      }
      // Unanswered too: another tab's `localStorage.clear()` forgets an
      // Allow, and builds before the question set cookies without asking
      disableGa(measurementId);
      parkGtagQueue();
      expireGaCookies(window.location.hostname);
    };
    apply(readConsent());
    return subscribe(apply);
  }, [measurementId]);

  // eslint-disable-next-line unicorn/no-null -- a component's return type admits `null`, not `undefined`
  return null;
};
