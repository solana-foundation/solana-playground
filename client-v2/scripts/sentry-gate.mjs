// Which builds carry and initialise Sentry. craco.config.js swaps the Sentry
// reporter for a stub that sends nothing in every other build, so the SDK is not
// bundled there at all.

/**
 * Whether this build reports to Sentry: it needs a DSN, and Vercel's
 * environment must be `production`, or `preview` with
 * `SENTRY_PREVIEW_ENABLED=true`. A local or CI build, which has no
 * `VERCEL_ENV`, does not report.
 *
 * @param {Record<string, string | undefined>} env the build's environment
 * @returns {boolean}
 */
export const sentryEnabled = (env) => {
  if (!env.REACT_APP_SENTRY_DSN) return false;
  if (env.VERCEL_ENV === "production") return true;
  return env.VERCEL_ENV === "preview" && env.SENTRY_PREVIEW_ENABLED === "true";
};
