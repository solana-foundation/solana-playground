import { createTracker } from "../../../shared/lib/telemetry";
import type { NavItem } from "./nav-item";

type NavEvents = {
  /**
   * A user picked one of the navigation's items; `item` is the item picked,
   * not the page it opened (until they have pages, Home and New project open
   * the gallery, the same as Tutorials does).
   */
  nav_item_opened: { item: NavItem };
};

export const navTelemetry = createTracker<NavEvents>();
