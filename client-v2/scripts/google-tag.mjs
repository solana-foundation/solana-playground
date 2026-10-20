// Google's tag snippet, written into index.html at build time by
// craco.config.js. Only a build with a measurement id gets it, so a build
// without one carries no tracker code. `src/shared/lib/telemetry` builds the
// same gtag.js URL: `GoogleAnalytics` skips its own script when it finds this
// one, and `ga4Provider` reuses the `window.gtag` this defines.

export const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";

// The id lands inside an inline script, so anything but the GA4 shape is refused
const GA4_ID = /^G-[A-Z0-9]+$/;

// A regex, not includes(GTAG_SRC): js/incomplete-url-substring-sanitization reads includes as a URL check
const GTAG_SRC_PATTERN = GTAG_SRC.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const GTAG_SCRIPT = new RegExp(
  `<script\\b[^>]*\\ssrc=["']${GTAG_SRC_PATTERN}[?"']`
);

/**
 * `html` with the Google tag placed right after `<head>`, as Google's install
 * guide asks. Unchanged when a `<script src>` already loads gtag.js.
 *
 * @param {string} html
 * @param {string} id a GA4 measurement id
 * @returns {string}
 * @throws {Error} when `id` is not a GA4 measurement id
 */
export const insertGoogleTag = (html, id) => {
  if (!GA4_ID.test(id)) {
    throw new Error(`REACT_APP_GA_MEASUREMENT_ID is not a GA4 id: ${id}`);
  }
  if (GTAG_SCRIPT.test(html)) return html;

  const snippet =
    `<script async src="${GTAG_SRC}?id=${id}"></script>` +
    "<script>window.dataLayer=window.dataLayer||[];" +
    "window.gtag=function(){dataLayer.push(arguments)};" +
    `gtag("js",new Date());gtag("config","${id}");</script>`;
  return html.replace(/<head[^>]*>/, (head) => head + snippet);
};
