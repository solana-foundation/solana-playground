import { observabilityEnv } from "../../../shared/config/server-env.mjs";

/**
 * The ids the browser bundle needs to report errors and send analytics.
 *
 * Without them the app still builds and runs, and reports nothing. These
 * warnings make that visible in the build log and the function logs, where
 * someone looking at the deployment reads.
 */
export const OBSERVABILITY_IDS = {
  REACT_APP_SENTRY_DSN: "errors are not reported to Sentry",
  REACT_APP_GA_MEASUREMENT_ID: "events are not sent to Google Analytics",
};

/** One message per id absent from `env` */
export const missingObservabilityIds = (env) =>
  Object.entries(OBSERVABILITY_IDS)
    .filter(([name]) => !env[name])
    .map(([name, consequence]) => `${name} is not set; ${consequence}`);

let warned = false;

/** Warns once per function instance, so each cold start says what the deployment lacks */
export const warnAboutMissingObservabilityIds = (env = observabilityEnv()) => {
  if (warned) return;
  warned = true;
  for (const message of missingObservabilityIds(env)) {
    console.warn(`api: ${message}`);
  }
};
