import {
  consoleProvider,
  createLogger,
  initLogger,
  installGlobalHandlers,
  sentryProvider,
} from "../../../shared/lib/logger";
import type { Level } from "../../../shared/lib/logger";
import {
  ga4Provider,
  initTelemetry,
  logProvider,
} from "../../../shared/lib/telemetry";
import { observabilityTelemetry } from "./telemetry";

export interface ObservabilityConfig {
  sentry: { dsn?: string; release?: string; environment?: string };
  googleAnalytics: { measurementId?: string };
  /** Console threshold; the console provider's default when absent */
  logLevel?: Level;
}

const log = createLogger("observability:init");

let initialised = false;

/** Names each vendor left off for want of an id, so a misconfigured deploy shows in the console */
const warnAboutMissingIds = ({
  sentry,
  googleAnalytics,
}: ObservabilityConfig) => {
  if (!sentry.dsn) {
    log.warn("Sentry DSN is not set; errors are not reported to Sentry");
  }
  if (!googleAnalytics.measurementId) {
    log.warn(
      "GA4 measurement id is not set; events are not sent to Google Analytics"
    );
  }
};

/** Runs once per page: React's StrictMode renders twice, and `Sentry.init` must not */
export const initObservability = ({
  sentry,
  googleAnalytics,
  logLevel,
}: ObservabilityConfig) => {
  if (initialised) return;
  initialised = true;

  initLogger({
    providers: [consoleProvider({ level: logLevel }), sentryProvider(sentry)],
  });
  warnAboutMissingIds({ sentry, googleAnalytics });
  installGlobalHandlers();
  initTelemetry({
    providers: [ga4Provider(googleAnalytics), logProvider()],
  });
  observabilityTelemetry.track("obs_initialised", {});
};

/** Test seam: allow the next `initObservability` to run */
export const resetObservability = () => {
  initialised = false;
};
