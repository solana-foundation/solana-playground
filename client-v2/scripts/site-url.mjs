import { PRODUCTION_HOST } from "./robots.mjs";

/** The text in `public/index.html` that `craco.config.js` replaces with {@link resolveSiteUrl} */
export const SITE_URL_PLACEHOLDER = "%SITE_URL%";

/**
 * The site's origin. Card URLs must be absolute: crawlers do not resolve
 * relative ones, so `%PUBLIC_URL%` cannot serve here.
 *
 * @param {Record<string, string | undefined>} env the build's environment
 * @returns {string} an `http` or `https` origin, without a trailing slash
 * @throws when the chosen value is not an absolute `http(s)` URL without a path
 */
export const resolveSiteUrl = (env) => {
  const [name, value] = [
    ["SITE_URL", env.SITE_URL],
    [
      "VERCEL_PROJECT_PRODUCTION_URL",
      env.VERCEL_PROJECT_PRODUCTION_URL &&
        `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`,
    ],
  ].find(([, candidate]) => candidate) ?? [
    "PRODUCTION_HOST",
    `https://${PRODUCTION_HOST}`,
  ];
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${name} gives "${value}", not an absolute URL`, {
      cause: error,
    });
  }
  const isOrigin =
    ["http:", "https:"].includes(url.protocol) &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash;
  if (!isOrigin) {
    throw new Error(
      `${name} gives "${value}"; the share card needs an http(s) origin with no path`
    );
  }
  return url.origin;
};
