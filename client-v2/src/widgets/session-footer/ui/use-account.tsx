import { useRef, useState } from "react";

import { isSetupRejected } from "@/commands/connect/setup-rejected";
import { isSignInFailure, PgSession } from "@/features/auth";
import { FeedbackMenuItems, useFeedbackSend } from "@/features/feedback";
import { useBalance, useRenderOnChange, useWallet } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { PgCommand, PgCommon, PgView, PgWallet } from "@/utils";
import type { SettingsRequest } from "@/shared/lib/settings-request";
import type {
  AccountItem,
  AccountSession,
  AccountSurface,
  AccountView,
} from "../model/account";
import { sessionTelemetry } from "../model/telemetry";
import { useClusterStatus } from "../model/use-cluster-status";
import BaseAccountMenu from "./BaseAccountMenu";
import BaseSignOutDialog from "./BaseSignOutDialog";

const log = createLogger("session-footer:account");

const warnWallet = () =>
  PgView.setToast(
    () => (
      <span>
        <strong>Couldn't change the wallet.</strong> The console has the
        details.
      </span>
    ),
    { options: { name: "wallet-failed" } }
  );

interface UseAccountOptions {
  from: AccountSurface;
  onToggleSettings: (request: SettingsRequest) => void;
  /** The menu is a page of its own: the phone's menu page holds the footer */
  page?: boolean;
  /**
   * Makes way for the wallet window: on a phone's menu page it brings the
   * work, where the window opens, into view. Flow passes the shell's
   * `closeSheet`, which does nothing from `LAYOUT_BREAKPOINTS.phone` up.
   * Disconnecting opens no window, so it does not call it
   */
  closeSheet?: () => void;
}

/**
 * What both account controls show and do. Sign-in progress is read from
 * `PgSession`, never kept here: the footer is swapped for the rail's, and
 * remounted when the window crosses `LAYOUT_BREAKPOINTS.phone`, while the
 * sign-in goes on.
 */
export const useAccount = ({
  from,
  onToggleSettings,
  page = false,
  closeSheet,
}: UseAccountOptions) => {
  const cluster = useClusterStatus();
  useRenderOnChange(PgSession.onDidChange);
  const wallet = useWallet();
  const balance = useBalance();
  const { sending, triggerRef } = useFeedbackSend();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  // The dialog's busy button already stops a second click; this stops a
  // second dialog (the footer and the rail swap) from starting another
  const signingOut = useRef<Promise<void> | null>(null);

  const user = PgSession.get();
  // A session wins over the sign-in state: a sign-in that failed before the
  // session arrived (another tab, a reload) stays failed in `PgSession`
  const session: AccountSession = user
    ? {
        status: "signed-in",
        user: { name: user.name, login: user.login, image: user.image },
      }
    : PgSession.signInState();
  const account: AccountView = {
    session,
    wallet: wallet
      ? {
          address: wallet.publicKey.toBase58(),
          balance: typeof balance === "number" ? balance : null,
          name: wallet.isPg ? null : wallet.name,
        }
      : null,
    cluster,
    sending,
  };

  // `connect` toggles: no wallet to the Playground wallet, the Playground
  // wallet to none, an extension wallet back to the Playground one. It
  // rejects when the user closes the setup, which is their choice, not a fault
  const toggleWallet = (item: AccountItem) => {
    PgCommand.connect.execute().catch((error: unknown) => {
      if (isSetupRejected(error)) {
        log.info("wallet setup dismissed", { context: { item } });
        return;
      }
      log.error(error, { report: true, context: { item } });
      warnWallet();
    });
  };

  // Keyed by item, so a new item without an action does not compile
  const actions: Record<AccountItem, () => void> = {
    "sign-in": () => {
      PgSession.signIn().catch((error: unknown) => {
        // `PgSession.signInState` holds a known failure and the row shows it
        // from there; `auth` telemetry has its reason
        if (isSignInFailure(error)) {
          log.info("sign-in failed", { context: { error: String(error) } });
          return;
        }
        log.error(error, { report: true, context: { item: "sign-in" } });
      });
    },
    "cancel-sign-in": () => PgSession.cancelSignIn(),
    // Links: the anchor opens the tab, the pick is only counted
    "github-profile": () => undefined,
    docs: () => undefined,
    "sign-out": () => setConfirmingSignOut(true),
    // The item unmounts with its menu, so focus comes back to the trigger
    settings: () =>
      onToggleSettings({
        from: "menu",
        focus: "page",
        returnTo: triggerRef.current,
      }),
    "cluster-down": () =>
      onToggleSettings({
        from: "menu",
        focus: "network",
        returnTo: triggerRef.current,
      }),
    "connect-wallet": () => {
      closeSheet?.();
      toggleWallet("connect-wallet");
    },
    "disconnect-wallet": () => toggleWallet("disconnect-wallet"),
    wallet: () => {
      closeSheet?.();
      PgWallet.show = true;
    },
  };

  const pick = (item: AccountItem) => {
    sessionTelemetry.track("session_account_item_picked", { item });
    actions[item]();
  };

  const onMenuOpenChange = (open: boolean) => {
    if (open) sessionTelemetry.track("session_account_menu_opened", { from });
  };

  const signOut = async () => {
    signingOut.current ??= PgSession.signOut()
      .catch((error: unknown) => {
        log.error(error, { report: true, context: { item: "sign-out" } });
        // Rethrown so the dialog's button tells the user and the dialog
        // stays: they are still signed in
        throw error;
      })
      .finally(() => {
        signingOut.current = null;
      });
    await signingOut.current;
    setConfirmingSignOut(false);
  };

  const menu = (
    <BaseAccountMenu
      account={account}
      feedback={<FeedbackMenuItems />}
      side={from === "footer" ? "top" : "right"}
      settingsShortcut={PgCommon.getOS() === "MacOS" ? "⌘," : "Ctrl+,"}
      onPick={pick}
      page={page}
    />
  );

  const dialog = (
    <BaseSignOutDialog
      open={confirmingSignOut}
      onOpenChange={setConfirmingSignOut}
      onConfirm={signOut}
    />
  );

  return {
    account,
    pick,
    menu,
    dialog,
    onMenuOpenChange,
    accountRef: triggerRef,
  };
};
