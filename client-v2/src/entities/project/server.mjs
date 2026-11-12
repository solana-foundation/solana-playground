/**
 * What this entity offers server code: the same limits and check the browser
 * reads through `index.ts`, so the route and the client measure a project
 * with the same lines.
 *
 * TODO(HOO-2605): `MEASURE` in `features/persistence/model/projects.mjs`
 * restates these measures in SQL and must change with them.
 */
export {
  ACCOUNT_LIMITS,
  checkProjectLimits,
  isSyncedPath,
  limitExceeded,
  PROJECT_LIMITS,
  SYNCED_WORKSPACE_FILES,
} from "./limits.mjs";
