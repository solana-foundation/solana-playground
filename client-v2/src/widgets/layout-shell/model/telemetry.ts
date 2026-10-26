import { createTracker } from "@/shared/lib/telemetry";
import type { Viewport } from "@/shared/lib/hooks/use-viewport";
import type { LayoutPanel, RestoreFailure } from "./layout-state";
import type {
  PageSource,
  PhonePage,
  WorkView,
  WorkViewSource,
} from "./phone-pages";

/**
 * What opened or closed a panel: a click, a key, a drag of its edge, or the
 * product itself (`auto`): a deploy or "Fix with assistant" opening one, or a
 * modal closing the phone's Files Sheet, which would keep focus from the modal
 */
export type ToggleSource = "button" | "key" | "drag" | "auto";

type LayoutEvents = {
  /**
   * A panel opened or closed; `via` says whether a button, a key, a drag or the
   * product did it. `panel` is `nav`, `files`, `assistant` or `console`; the
   * files column was `left` before the navigation took its own name, so a
   * dashboard grouping on `panel` reads `left` for earlier events.
   */
  layout_panel_toggled: {
    panel: LayoutPanel;
    open: boolean;
    via: ToggleSource;
  };
  /** The window's width class, once per page load. */
  layout_viewport: { viewport: Viewport };
  /** The saved layout could not be read and the defaults were used; `reason` says why. */
  layout_restore_failed: { reason: RestoreFailure };
  /**
   * A phone page came into view after the load; `via` says what moved it: a
   * swipe, a button, a key (Ctrl+R from another page) or the product (`auto`).
   * Crossing into the phone width with the stage off `write` is the product
   * bringing the preview into view, so it sends one `auto` event.
   */
  layout_page_shown: { page: PhonePage; via: PageSource };
  /** The work page switched between the assistant and the code. */
  layout_work_view: { view: WorkView; via: WorkViewSource };
  /**
   * Widen or Narrow in the assistant's head was clicked and changed the
   * panel; `wide` is the new state. Not sent when hiding the assistant or a
   * drag of its edge ends the widening, which are no one's choice of width.
   */
  layout_assistant_widened: { wide: boolean };
};

export const layoutTelemetry = createTracker<LayoutEvents>();
