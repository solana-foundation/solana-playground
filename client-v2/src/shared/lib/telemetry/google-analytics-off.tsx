/**
 * Stands in for `./google-analytics` in a build without
 * `REACT_APP_GA_MEASUREMENT_ID`, so no gtag.js code is bundled; craco.config.js
 * makes the swap.
 */
export const GoogleAnalytics = (): null => null;
