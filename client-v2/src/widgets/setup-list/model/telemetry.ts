import { createTracker, type NoParams } from "@/shared/lib/telemetry";
import type { SetupStep } from "./steps";

type SetupEvents = {
  /** A user clicked a step that is not done yet, which runs its action. */
  setup_item_picked: { item: SetupStep };
  /** A user dismissed the checklist; `done` is how many steps were done. */
  setup_dismissed: { done: number };
  /** All four steps were done together for the first time on this device. */
  setup_completed: NoParams;
};

export const setupTelemetry = createTracker<SetupEvents>();
