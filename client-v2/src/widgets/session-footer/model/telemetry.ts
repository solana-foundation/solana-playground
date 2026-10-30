import { createTracker } from "@/shared/lib/telemetry";
import type { AccountItem, AccountSurface } from "./account";

type SessionEvents = {
  /** The account menu opened; `from` is the control that opened it. */
  session_account_menu_opened: { from: AccountSurface };
  /**
   * A user picked an item of the account menu, or the row's Cancel while
   * signing in; the feedback entries are counted by `features/feedback`.
   */
  session_account_item_picked: { item: AccountItem };
  /**
   * The sign-out question in the account menu closed: `ok` once signed out,
   * with `items_kept` the projects left in this browser; `cancelled` on its
   * Cancel or when the menu closed over it. A failed sign-out sends nothing,
   * the question stays open.
   */
  session_sign_out_ended:
    | { outcome: "ok"; items_kept: number }
    | { outcome: "cancelled" };
};

export const sessionTelemetry = createTracker<SessionEvents>();
