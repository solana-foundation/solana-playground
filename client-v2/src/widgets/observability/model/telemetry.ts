import { createTracker } from "../../../shared/lib/telemetry";
import type { NoParams } from "../../../shared/lib/telemetry";

type ObservabilityEvents = {
  /** Logger and telemetry are initialised, once per page load. */
  obs_initialised: NoParams;
};

export const observabilityTelemetry = createTracker<ObservabilityEvents>();
