// What `playwright.config.mts` and the `analytics-consent` specs agree on.
// Plain constants, so the config can import it: it loads no app code.

/** The dev server's GA4 id, so the consent banner and the gtag path are live; a made-up id: gtag.js is requested for it but answered by the specs' stub, so nothing reaches Google */
export const TEST_MEASUREMENT_ID = "G-TEST000000";

/** The `localStorage` key `shared/lib/telemetry/consent.ts` keeps the visitor's choice under */
export const ANALYTICS_CHOICE_KEY = "analytics-consent";
