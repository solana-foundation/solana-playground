// What both halves of a project write have to agree on: `api/projects.mjs`
// refuses what breaks these, and the browser model builds what keeps them.
// `.mjs` so Node can import it directly; `allowJs` lets the TypeScript side
// import the same file (see `features/auth/config.mjs`).

/**
 * The largest project write, in bytes of request body.
 *
 * Under the platform's cap, not ours to pick: a Vercel Function refuses a
 * request body over 4.5 MB with its own 413 before the handler runs
 * (https://vercel.com/docs/functions/limitations). It is a hard limit on every
 * plan. The half-megabyte below it is headroom for "MB" meaning either unit,
 * so that whatever the user is refused by is this limit and this message.
 *
 * The browser checks it before sending, the handler again on the way in; the
 * banner's `too-large` text names it.
 */
export const MAX_PROJECT_BODY_BYTES = 4_000_000;

/** `MAX_PROJECT_BODY_BYTES` as the banner says it, derived so the two agree */
export const MAX_PROJECT_BODY_LABEL = `${
  MAX_PROJECT_BODY_BYTES / 1_000_000
} MB`;

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
