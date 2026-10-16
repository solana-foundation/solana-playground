// How the server says a write reached a tombstone. Spelled once, here,
// because both halves act on it: `api/*.mjs` sends it and the browser model
// decides what to drop from it -- a misspelling on one side compiled, read
// every 410 as `failed`, and pushed the thread again on every turn. `.mjs` so
// Node can import it directly; `allowJs` lets the TypeScript side import the
// same file (see `features/auth/config.mjs`).

/** The `reason` a refusal carries when the row it aimed at is a tombstone */
export const DELETED_REASON = "deleted";

/**
 * Whether a value names one of the two tombstones a conversation write can
 * hit: its thread's, or its project's.
 *
 * @param {unknown} scope
 * @returns {scope is "project" | "thread"}
 */
export const isDeletedScope = (scope) =>
  scope === "project" || scope === "thread";
