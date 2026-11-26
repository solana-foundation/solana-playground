/**
 * The `robots.txt` each deployment serves, emitted by `RobotsTxtPlugin` in
 * `craco.config.js`. `public/` holds no copy: upstream's file allows every
 * crawler everywhere.
 *
 * The production site lets crawlers in, except into `/api/`. A preview, and a
 * deployment that is not the public site but builds as production (a staging
 * project), sets `DISALLOW_ROBOTS=true` and disallows the whole site. The
 * variable is read at build time, so changing it takes a redeploy.
 *
 * `vercel.json` adds `X-Robots-Tag: noindex, nofollow` on every host but
 * `PRODUCTION_HOST`. It keys on the host, not on the variable, because
 * `vercel.json` cannot read the environment.
 */
export const DISALLOW_ROBOTS = "DISALLOW_ROBOTS";

/** The one host crawlers may index; `vercel.json` names it too */
export const PRODUCTION_HOST = "playground.solana.com";

/** A `robots.txt` that disallows the whole site to every crawler */
export const DISALLOW_ALL = "User-agent: *\nDisallow: /\n";

/** The production site's `robots.txt`: everything but the server routes */
export const ALLOW_SITE = "User-agent: *\nAllow: /\nDisallow: /api/\n";

/**
 * A preview always; otherwise only the exact value `true`, as `USE_WASM_STUBS`
 * reads, so a typo leaves the site crawlable rather than guessing
 *
 * @param {Record<string, string | undefined>} env
 */
export const isRobotsDisallowed = (env) =>
  env.VERCEL_ENV === "preview" || env[DISALLOW_ROBOTS] === "true";

/** @param {Record<string, string | undefined>} env */
export const robotsTxt = (env) =>
  isRobotsDisallowed(env) ? DISALLOW_ALL : ALLOW_SITE;
