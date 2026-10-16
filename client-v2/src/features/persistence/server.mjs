/**
 * What this feature offers a server route. The one door into it.
 *
 * Every statement that touches Postgres lives in `model/` beside the rest of
 * the feature's logic; this file says which of it a route may call. A route
 * that reaches past this into `model/db.mjs` for a pool, or into
 * `model/projects.mjs` for a helper that was never meant to leave, is the
 * thing this exists to make obvious in review.
 *
 * `.mjs`, not `.ts`, and that is not a preference: `api/*.mjs` is executed by
 * Vercel as plain ESM with no build step, and `tsconfig.json` covers `src`
 * for type-checking only (`noEmit`). Nothing compiles this, so it has to be
 * runnable as written.
 *
 * The client side of the feature has its own door -- the components and
 * models under `Component/` and `model/*.ts`, imported directly. Only the
 * server side is funnelled, because only the server side is reached from
 * outside `src/`.
 */
export {
  appendMessages,
  getThread,
  listMessages,
  listThreads,
  NotYours,
  ThreadDeleted,
} from "./model/conversations.mjs";

export { DELETED_REASON, isDeletedScope } from "./model/deleted.mjs";

export { getPool, isConfigured, isEnabled, query } from "./model/db.mjs";

export {
  deleteProject,
  getProject,
  listProjects,
  saveProject,
} from "./model/projects.mjs";
