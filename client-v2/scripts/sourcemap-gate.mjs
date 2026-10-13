// Which builds emit source maps. craco.config.js turns them on only here: they
// add build time and memory under Vercel's 8 GB limit, and a map in `build/` is
// served publicly unless something deletes it after uploading.

/**
 * Whether this build emits source maps: Vercel's environment must be
 * `production`, or `preview` with `SOURCEMAPS_PREVIEW_ENABLED=true`. A local or
 * CI build, which has no `VERCEL_ENV`, emits none.
 *
 * @param {Record<string, string | undefined>} env the build's environment
 * @returns {boolean}
 */
export const sourcemapsEnabled = (env) => {
  if (env.VERCEL_ENV === "production") return true;
  return (
    env.VERCEL_ENV === "preview" && env.SOURCEMAPS_PREVIEW_ENABLED === "true"
  );
};
