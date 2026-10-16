import { useEffect } from "react";

const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

/**
 * Loads gtag.js for `measurementId`, which drains the queue `ga4Provider` fills;
 * renders nothing. Without an id nothing is injected.
 */
export const GoogleAnalytics = ({
  measurementId,
}: {
  measurementId?: string;
}) => {
  useEffect(() => {
    if (!measurementId) return;
    const src = `${GTAG_SRC}?id=${encodeURIComponent(measurementId)}`;
    if (document.querySelector(`script[src="${src}"]`)) return;

    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }, [measurementId]);

  return null;
};
