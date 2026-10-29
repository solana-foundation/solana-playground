import { createTracker } from "@/shared/lib/telemetry";

type OverlayEvents = {
  /** A dialog opened: its frame mounted. */
  overlay_modal_opened: { name: string };
  /** A dialog's submit threw; the dialog stays open and shows the error. */
  overlay_modal_submit_failed: { name: string };
  /** A toast was shown, or replaced one with the same id. */
  overlay_toast_shown: { name: string };
};

export const overlayTelemetry = createTracker<OverlayEvents>();
