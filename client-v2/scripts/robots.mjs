/**
 * Whether a deployment keeps crawlers out. Upstream's `robots.txt`, mirrored
 * into `public/`, allows every crawler, which suits the production site; a
 * deployment that is not the public site (hoodies' Vercel project, used as a
 * preview) sets `DISALLOW_ROBOTS=true`, and `update-static.mjs` replaces the
 * mirrored file with `DISALLOW_ALL`.
 */
export const DISALLOW_ROBOTS = "DISALLOW_ROBOTS";

/** A `robots.txt` that disallows the whole site to every crawler */
export const DISALLOW_ALL = "User-agent: *\nDisallow: /\n";

/**
 * Only the exact value `true`, as `USE_WASM_STUBS` reads, so a typo leaves the
 * site crawlable rather than guessing
 *
 * @param {Record<string, string | undefined>} env
 */
export const isRobotsDisallowed = (env) => env[DISALLOW_ROBOTS] === "true";
