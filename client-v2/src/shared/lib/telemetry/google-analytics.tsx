import { useEffect } from "react";

import { createLogger } from "../logger";
import type { Consent } from "./consent";
import { readConsent, subscribe } from "./consent";
import { expireGaCookies } from "./ga-cookies";

const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

const log = createLogger("telemetry:google-analytics");

/** Google's documented switch: while it is true on `window`, gtag.js sends nothing for the id */
const setDisabled = (measurementId: string, disabled: boolean) => {
  Reflect.set(window, `ga-disable-${measurementId}`, disabled);
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
 * A choice that turns to `declined` after gtag.js ran sets
 * `ga-disable-<id>`, which stops the script sending; an Allow after that
 * clears the switch. While the choice is `declined` or `unanswered` the
 * `_ga` cookies are expired, including those builds from before the
 * question set without asking.
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
        setDisabled(measurementId, false);
        injectGtag(measurementId);
        return;
      }
      if (choice === "declined") setDisabled(measurementId, true);
      // Unanswered too: builds before the question set them without asking
      expireGaCookies(window.location.hostname);
    };
    apply(readConsent());
    return subscribe(apply);
  }, [measurementId]);

  // eslint-disable-next-line unicorn/no-null -- a component's return type admits `null`, not `undefined`
  return null;
};
