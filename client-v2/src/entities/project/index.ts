// Public API of the slice for browser code; `server.mjs` is the door for
// `api/` and the persistence feature's server modules.
// `ACCOUNT_LIMITS` is deliberately not here: only the server counts what an
// account holds, so browser code has no use for the figures.
export {
  checkWriteTo,
  checkProjectLimits,
  isSyncedPath,
  PROJECT_LIMITS,
  readLimitExceeded,
  SYNCED_WORKSPACE_FILES,
} from "./limits.mjs";
export type {
  AccountLimitExceeded,
  LimitExceeded,
  LimitReason,
  ProjectLimitExceeded,
} from "./limits.mjs";
export {
  limitBannerText,
  limitKind,
  limitRule,
  limitSummary,
} from "./model/describe";
export type { LimitKind } from "./model/describe";
