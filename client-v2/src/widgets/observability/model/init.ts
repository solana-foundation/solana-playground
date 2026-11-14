import type { Level } from "@/shared/lib/logger";
import {
  consoleProvider,
  createLogger,
  initLogger,
  installGlobalHandlers,
  sentryProvider,
} from "@/shared/lib/logger";
import {
  ga4Provider,
  initTelemetry,
  logProvider,
} from "@/shared/lib/telemetry";

import { observabilityTelemetry } from "./telemetry";

export interface ObservabilityConfig {
  sentry: {
    dsn?: string;
    release?: string;
    environment?: string;
    /** `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` as built; {@link parseTracesSampleRate} reads it */
    tracesSampleRate?: string;
  };
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

/** Every page load and navigation: `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` exists to lower the rate */
const DEFAULT_TRACES_SAMPLE_RATE = 1;

/**
 * The share of page loads and navigations to trace: {@link DEFAULT_TRACES_SAMPLE_RATE}
 * when unset or blank, and the same with a warning when the value is not a
 * number from 0 to 1.
 */
const parseTracesSampleRate = (value: string | undefined) => {
  const text = value?.trim() ?? "";
  if (text === "") return DEFAULT_TRACES_SAMPLE_RATE;
  const rate = Number(text);
  if (rate >= 0 && rate <= 1) return rate;
  log.warn(
    `REACT_APP_SENTRY_TRACES_SAMPLE_RATE is "${value}", not a number from 0 to 1; tracing every page load and navigation`
  );
  return DEFAULT_TRACES_SAMPLE_RATE;
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
    providers: [
      consoleProvider({ level: logLevel }),
      sentryProvider({
        dsn: sentry.dsn,
        release: sentry.release,
        environment: sentry.environment,
        tracesSampleRate: parseTracesSampleRate(sentry.tracesSampleRate),
      }),
    ],
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

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("widgets/observability/model/init", () => {
    afterEach(() => vi.restoreAllMocks());

    it.each([
      { value: undefined, rate: 1, warnings: 0 },
      { value: "", rate: 1, warnings: 0 },
      { value: " ", rate: 1, warnings: 0 },
      { value: "0", rate: 0, warnings: 0 },
      { value: "0.25", rate: 0.25, warnings: 0 },
      { value: "1", rate: 1, warnings: 0 },
      { value: "abc", rate: 1, warnings: 1 },
      { value: "1.5", rate: 1, warnings: 1 },
      { value: "-1", rate: 1, warnings: 1 },
    ])(
      "parseTracesSampleRate reads $value as $rate with $warnings warnings",
      ({ value, rate, warnings }) => {
        const warn = vi.spyOn(log, "warn").mockImplementation(() => {});

        expect(parseTracesSampleRate(value)).toBe(rate);
        expect(warn).toHaveBeenCalledTimes(warnings);
        if (warnings) {
          expect(warn.mock.calls[0][0]).toContain(
            `REACT_APP_SENTRY_TRACES_SAMPLE_RATE is "${value}"`
          );
        }
      }
    );
  });
}
