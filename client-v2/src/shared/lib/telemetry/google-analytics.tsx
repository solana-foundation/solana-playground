import { useEffect } from "react";

import type { Consent } from "./consent";
import { readConsent, subscribe } from "./consent";
import { expireGaCookies } from "./ga-cookies";

const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

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
  document.head.appendChild(script);
};

/**
 * Loads gtag.js for `measurementId` once the visitor allows analytics
 * (`analytics-consent`), which then drains the queue `ga4Provider` fills;
 * renders nothing. Without an id, or while the choice is not `allowed`,
 * nothing is injected.
 *
 * A choice that turns to `declined` after gtag.js ran sets
 * `ga-disable-<id>`, which stops the script sending, and expires its cookies;
 * an Allow after that clears the switch.
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
      if (choice === "declined") {
        setDisabled(measurementId, true);
        expireGaCookies(window.location.hostname);
      }
    };
    apply(readConsent());
    return subscribe(apply);
  }, [measurementId]);

  return null;
};
