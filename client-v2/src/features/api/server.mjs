/**
 * What server routes share: reading a body, the observability wrapper, and
 * the cron routes' gate and JSON answer. The one door into this feature; it
 * has no browser side.
 *
 * `.mjs` because `api/*.mjs` runs as plain ESM with no build step. See
 * `features/persistence/server.mjs` for the reasoning in full.
 */
export { refuseCronFor } from "./server/cron.mjs";
export { readJson } from "./server/read-json.mjs";
export { sendJsonFor } from "./server/send-json.mjs";

export {
  missingObservabilityIds,
  warnAboutMissingObservabilityIds,
} from "./server/observability.mjs";

export { withObservability } from "./server/with-observability.mjs";
