// Values shared by the panel's AI library under `src` and `/api/agent`, which
// is plain ESM outside the TS build (see api/health.mjs). `.mjs` so Node can
// import it directly; `allowJs` lets the TypeScript side import the same file
// rather than restate it.

/**
 * `code` on the error frame `/api/agent` sends when its own read of the model
 * fails mid-reply; `isNetworkFailure` reads it as a dropped connection
 */
export const UPSTREAM_DROPPED = "upstream_connection_lost";
