/**
 * What this feature offers `api/build-server.mjs`. The one door into it.
 *
 * Plain ESM for the same reason as the other `server.mjs` slices: Vercel runs
 * the route with no build step. The audit's statements run on a `query` the
 * route passes in, so this feature imports no other.
 */
export { finishAuditWith, startAuditWith } from "./server/audit.mjs";
export {
  MAX_PROJECT_FIELD,
  projectOf,
  resolveRoute,
  upstreamPath,
} from "./server/route.mjs";
