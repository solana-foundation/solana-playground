// Public API of the slice for browser code; `server.mjs` is the door for
// `api/` and the persistence feature's server modules.
export {
  checkFileWrite,
  checkProjectLimits,
  isSyncedPath,
  PROJECT_LIMITS,
  readLimitExceeded,
  SYNCED_WORKSPACE_FILES,
} from "./limits.mjs";
export type { LimitExceeded, LimitReason } from "./limits.mjs";
export {
  limitBannerText,
  limitKind,
  limitRule,
  limitSummary,
} from "./model/describe";
export type { LimitKind } from "./model/describe";
