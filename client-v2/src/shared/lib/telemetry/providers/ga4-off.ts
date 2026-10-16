import type { TelemetryProvider } from "../types";

/**
 * Stands in for `./ga4` in a build without `REACT_APP_GA_MEASUREMENT_ID`, so
 * no gtag queue code is bundled; craco.config.js makes the swap.
 */
export const ga4Provider = (): TelemetryProvider => ({ send: () => {} });
