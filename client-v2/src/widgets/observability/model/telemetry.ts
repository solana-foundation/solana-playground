import type { ConsentChoice, NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

/** Where a visitor made their analytics choice */
export type ConsentVia = "banner" | "settings";

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
    choice: ConsentChoice;
    via: ConsentVia;
  };
};

export const observabilityTelemetry = createTracker<ObservabilityEvents>();
