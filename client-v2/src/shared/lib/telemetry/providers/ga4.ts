import type { TelemetryEvent, TelemetryProvider } from "../types";

// gtag.js is a browser script, and Google's snippet puts both on `window`
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const paramsOf = ({ params, scope }: TelemetryEvent) =>
  scope === undefined ? params : { ...params, scope };

/** The queue gtag.js drains once it loads; it reads `arguments` objects, not arrays */
const installGtagQueue = (measurementId: string) => {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId);
};

/**
 * Sends events to GA4 for `measurementId`; without one, or outside a browser, sends nothing.
 *
 * Queues from creation, so events tracked before `GoogleAnalytics` loads gtag.js are kept.
 */
export const ga4Provider = ({
  measurementId,
}: {
  measurementId?: string;
}): TelemetryProvider => {
  if (!measurementId || typeof window === "undefined") {
    return { send: () => {} };
  }
  if (!window.gtag) installGtagQueue(measurementId);

  return {
    send: (event) => window.gtag?.("event", event.name, paramsOf(event)),
  };
};
