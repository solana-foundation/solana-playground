// The shape of a GA4 measurement id. The tag is not written into index.html:
// `GoogleAnalytics` (`src/shared/lib/telemetry`) injects gtag.js only once the
// visitor allows analytics (`analytics-consent`), and `ga4Provider` defines
// `window.gtag` on the first event sent after that.

export const GA4_ID = /^G-[A-Z0-9]+$/;
