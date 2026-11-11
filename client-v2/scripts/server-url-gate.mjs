// Fails a deployment build that has no build server URL. `build:bundle` runs it
// first, so a misconfigured Vercel project stops before bundling instead of
// shipping a client whose builds go to localhost.

import { fileURLToPath } from "url";

/**
 * Why this build cannot go on, or `undefined` when it can: a Vercel build
 * (`VERCEL_ENV` set) needs `REACT_APP_SERVER_URL`. A local or CI build, which
 * has no `VERCEL_ENV`, passes without it.
 *
 * @param {Record<string, string | undefined>} env the build's environment
 * @returns {string | undefined}
 */
export const missingServerUrl = (env) => {
  if (!env.VERCEL_ENV || env.REACT_APP_SERVER_URL) return undefined;
  return `REACT_APP_SERVER_URL is not set for this ${env.VERCEL_ENV} build. Set it in the Vercel project's environment variables.`;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reason = missingServerUrl(process.env);
  if (reason) {
    console.error(reason);
    process.exit(1);
  }
}
