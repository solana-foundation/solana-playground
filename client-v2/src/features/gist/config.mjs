// Values both halves of the feature agree on: the browser's format and dialog
// under `lib/` and `model/`, and the `/api/gists` route, which is plain ESM
// outside the TS build (see api/health.mjs). `.mjs` so Node imports it as
// written; `allowJs` lets the TypeScript side import the same file.

/** The manifest every exported gist carries; a gist without it is hand-made */
export const MANIFEST_NAME = ".playground.json";

/** Below Vercel's 4.5 MB request body limit, with room for the JSON around it */
export const MAX_GIST_BYTES = 4 * 1024 * 1024;

/** GitHub's API lists at most 300 files of a gist; more would not open again */
export const MAX_GIST_FILES = 300;

/**
 * A gist's description is the project's name, cut to this. Workspace names
 * have no length limit, so the browser cuts and the route refuses longer.
 */
export const MAX_DESCRIPTION = 200;

/** `reason` on the route's 403 when the user's token cannot create gists */
export const NEEDS_GIST_SCOPE = "needs-gist-scope";

/** `reason` on the route's 401 when GitHub no longer accepts the user's token */
export const GITHUB_UNAUTHORIZED = "github-unauthorized";

/** The OAuth scope the route needs, asked for only when it is missing */
export const GIST_SCOPE = "gist";
