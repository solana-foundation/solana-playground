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
};

export const sessionTelemetry = createTracker<SessionEvents>();
