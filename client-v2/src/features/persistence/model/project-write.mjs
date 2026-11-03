// What both halves of a project write have to agree on: `api/projects.mjs`
// refuses what breaks these, and the browser model builds what keeps them.
// `.mjs` so Node can import it directly; `allowJs` lets the TypeScript side
// import the same file (see `features/auth/config.mjs`).

/**
 * The largest project write, in bytes of request body: 1 MiB.
 *
 * Twice `PROJECT_LIMITS.projectBytes`, so a full upload of a project at the
 * size limit fits with room for JSON escaping (the `sync-size-limits` change,
 * "The body cap follows from the project limit"). The project limits, not
 * this, are what a user meets: the browser checks them before every upload
 * and the route again. This only stops a body no project under those limits
 * produces, short of content made mostly of characters JSON escapes. It sits
 * below Vercel's own cap: a Function refuses a request body over 4.5 MB with
 * its own 413 before the handler runs (https://vercel.com/docs/functions/limitations),
 * so a refusal for size is always this route's, never the platform's. Kept
 * in step with `PROJECT_LIMITS.projectBytes` by hand.
 *
 * The browser checks it before sending, the handler again on the way in; the
 * banner's `too-large` text names it.
 */
export const MAX_PROJECT_BODY_BYTES = 1024 * 1024;

/** `MAX_PROJECT_BODY_BYTES` as the banner says it, derived so the two agree */
export const MAX_PROJECT_BODY_LABEL = `${
  MAX_PROJECT_BODY_BYTES / (1024 * 1024)
} MiB`;

/**
 * The `reason` of the 400 a write gets when it would leave the project with
 * no files. The browser answers it by sending its whole file set: it only
 * ever sends such a patch against a row that is already empty, and the whole
 * set is what puts the files back.
 */
export const NO_FILES_REASON = "no-files";

/** Ids of tutorial projects carry this prefix; every other id is a uuid */
export const TUTORIAL_ID_PREFIX = "tut:";

/**
 * The kind a project id stands for.
 *
 * The id decides, not the caller: a tutorial's id is derived from its name
 * (`tutorialProjectId`), so the two kinds share one id space only because the
 * prefix keeps them apart, and a row whose kind disagrees with its id is one
 * neither side can read back correctly.
 *
 * @param {string} id
 * @returns {"project" | "tutorial"}
 */
export const projectKindOf = (id) =>
  id.startsWith(TUTORIAL_ID_PREFIX) ? "tutorial" : "project";
