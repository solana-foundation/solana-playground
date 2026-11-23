import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

type ObservabilityEvents = {
  /** Logger and telemetry are initialised, once per page load. */
  obs_initialised: NoParams;
  /**
   * A visitor's analytics choice was stored: `choice` is what they picked,
   * `via` where, on the consent banner or the Settings switch. Tracked after
   * the store is written, so an `allowed` choice reaches GA4 and a `declined`
   * one only the log.
   */
  obs_analytics_consent_set: {
    choice: "allowed" | "declined";
    via: "banner" | "settings";
  };
};

export const observabilityTelemetry = createTracker<ObservabilityEvents>();
