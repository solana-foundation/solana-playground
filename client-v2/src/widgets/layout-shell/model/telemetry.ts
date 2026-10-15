import { createTracker } from "../../../shared/lib/telemetry";
import type { NoParams } from "../../../shared/lib/telemetry";
import type { Viewport } from "../../../shared/lib/hooks/use-viewport";
import type { LayoutPanel, RestoreFailure } from "./layout-state";

/**
 * What opened or closed a panel: a click, a key, a drag of its edge, or the
 * product itself (`auto`): a deploy or "Fix with assistant" opening one, or a
 * modal closing the project Sheet, which would keep focus from the modal
 */
export type ToggleSource = "button" | "key" | "drag" | "auto";

type LayoutEvents = {
  /** A panel opened or closed; `via` says whether a button, a key, a drag or the product did it. */
  layout_panel_toggled: {
    panel: LayoutPanel;
    open: boolean;
    via: ToggleSource;
  };
  /** The window's width class, once per page load. */
  layout_viewport: { viewport: Viewport };
  /** The user tried to type in the read-only editor; the first time in a page load. */
  layout_readonly_edit_blocked: NoParams;
  /** The saved layout could not be read and the defaults were used; `reason` says why. */
  layout_restore_failed: { reason: RestoreFailure };
};

export const layoutTelemetry = createTracker<LayoutEvents>();
