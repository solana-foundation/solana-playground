import type { ConsentChoice } from "@/shared/lib/telemetry";
import { writeConsent } from "@/shared/lib/telemetry";

import type { ConsentVia } from "./telemetry";
import { observabilityTelemetry } from "./telemetry";

/**
 * Stores the visitor's choice, then tracks it: in that order, so an Allow is
 * already stored when the event reaches the GA4 provider, which asks the store.
 * A choice storage refused still holds for the page and is still tracked.
 *
 * @returns whether the choice was stored, so it outlives a reload
 */
export const chooseConsentFor =
  (via: ConsentVia) =>
  (choice: ConsentChoice): boolean => {
    const saved = writeConsent(choice);
    observabilityTelemetry.track("obs_analytics_consent_set", { choice, via });
    return saved;
  };
