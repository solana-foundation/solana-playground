import { writeConsent } from "@/shared/lib/telemetry";

import { observabilityTelemetry } from "./telemetry";

type ConsentVia = "banner" | "settings";

/** What a visitor can pick; `unanswered` is the state before any pick */
export type ConsentChoice = "allowed" | "declined";

/**
 * Stores the visitor's choice, then tracks it: in that order, so an Allow is
 * already stored when the event reaches the GA4 provider, which asks the store.
 */
export const chooseConsentFor =
  (via: ConsentVia) =>
  (choice: ConsentChoice): void => {
    writeConsent(choice);
    observabilityTelemetry.track("obs_analytics_consent_set", { choice, via });
  };
