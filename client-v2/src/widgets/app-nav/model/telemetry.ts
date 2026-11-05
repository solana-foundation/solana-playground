import type { NoParams } from "@/shared/lib/telemetry";
import { createTracker } from "@/shared/lib/telemetry";

import type { NavItem } from "./nav-item";
import type { ProjectAction } from "./project-action";

type NavEvents = {
  /**
   * A user picked one of the navigation's items; `item` is the item picked,
   * not what it opened (Tutorials and Programs open their pages; New project
   * closes a page that shows and opens the gallery; Home closes a page that
   * shows, else opens the gallery whenever Home is not on screen, and opens
   * nothing while Home itself shows).
   */
  nav_item_opened: { item: NavItem };
  /**
   * An action started from the navigation's project list: a click on the row
   * (open) or on a menu item (`via: click`), or the item's letter while the
   * menu is open (`via: key`). `rename` is sent on commit; `export`,
   * `share-gist` and `delete` when their dialog opens, since the dialog owns
   * what follows.
   */
  nav_project_action: { action: ProjectAction; via: "click" | "key" };
  /**
   * The list's own part of a project action failed (an open, a pin, a
   * rename, a duplicate, or a dialog that did not open); the user was told
   * and the error was logged. A failure inside the export, share or delete
   * dialog is that dialog's to report.
   */
  nav_project_action_failed: { action: ProjectAction };
  /**
   * The phone's "Continue on a computer" sheet opened from the menu page;
   * `signedIn` is whether account sync carries the project to the computer.
   */
  nav_handoff_opened: { signedIn: boolean };
  /** The sheet's link reached the clipboard ("Copy link" read "Copied") */
  nav_handoff_link_copied: NoParams;
  /** The browser's share sheet took the link; a share the user closed is not sent */
  nav_handoff_link_shared: NoParams;
};

export const navTelemetry = createTracker<NavEvents>();
