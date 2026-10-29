import { useRef, useState } from "react";

import { isSetupRejected } from "@/commands/connect/setup-rejected";
import { isSignInFailure, PgSession } from "@/features/auth";
import { FeedbackMenuItems, useFeedbackSend } from "@/features/feedback";
import { useBalance, useRenderOnChange, useWallet } from "@/hooks";
import { useOnline } from "@/shared/lib/hooks/use-online";
import { createLogger } from "@/shared/lib/logger";
import { PgCommand, PgCommon, PgExplorer, PgView, PgWallet } from "@/utils";
import type { SettingsRequest } from "@/shared/lib/settings-request";
import type {
  AccountItem,
  AccountSession,
  AccountSurface,
  AccountView,
  SignOutState,
} from "../model/account";
import { shownSignOutState } from "../model/account";
import { sessionTelemetry } from "../model/telemetry";
import { useClusterStatus } from "../model/use-cluster-status";
import BaseAccountMenu from "./BaseAccountMenu";

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
  const online = useOnline();
  const [signOutState, setSignOutState] = useState<SignOutState>({
    status: "idle",
  });
  // The question's busy item already stops a second press; this stops a
  // second question (the footer and the rail swap) from starting another
  const signingOut = useRef<Promise<void> | null>(null);
  // Whether the menu is open, for a sign-out that settles after a close
  const menuOpen = useRef(false);

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
    online,
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
    "sign-out": () => setSignOutState({ status: "asking" }),
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

  /** The question closed unanswered: its Cancel, or the menu closing over it */
  const cancelSignOut = () => {
    sessionTelemetry.track("session_sign_out_ended", { outcome: "cancelled" });
    setSignOutState({ status: "idle" });
  };

  const onMenuOpenChange = (open: boolean) => {
    menuOpen.current = open;
    if (open) {
      sessionTelemetry.track("session_account_menu_opened", { from });
      return;
    }
    // A sign-out under way is counted when it ends, not as a cancel; it
    // settles into a closed menu, which `signOut` sees
    if (signOutState.status === "asking" && !signingOut.current) {
      cancelSignOut();
      return;
    }
    // The leftovers line is said once, in the menu that signed out. Only
    // then a render: a close that re-renders would hand a pick deferred to
    // the close (`BaseAccountMenu`'s `closeAfterPick`) a stale render
    if (signOutState.status === "done") setSignOutState({ status: "idle" });
  };

  const signOut = async () => {
    // Counted and settled once per sign-out, inside the shared promise: a
    // second press, from a menu reopened while it runs, only joins it
    signingOut.current ??= PgSession.signOut()
      .then(() => {
        // Everything still in the browser once the release ran
        // (`releaseLocalProjects`): projects the account does not hold, or
        // holds without this browser's latest edits
        const kept = PgExplorer.allWorkspaceNames?.length ?? 0;
        sessionTelemetry.track("session_sign_out_ended", {
          outcome: "ok",
          items_kept: kept,
        });
        // Said in the menu that signed out, never in one opened later
        setSignOutState(
          menuOpen.current ? { status: "done", kept } : { status: "idle" }
        );
      })
      .catch((error: unknown) => {
        log.error(error, { report: true, context: { item: "sign-out" } });
        // Rethrown so the question's Sign out tells the user and the
        // question stays: they are still signed in. Closed over meanwhile,
        // the menu opens on its items next time, not on a question
        if (!menuOpen.current) setSignOutState({ status: "idle" });
        throw error;
      })
      .finally(() => {
        signingOut.current = null;
      });
    await signingOut.current;
  };

  const shownSignOut = shownSignOutState(signOutState, {
    signedIn: !!user,
    running: !!signingOut.current,
  });

  const menu = (
    <BaseAccountMenu
      account={account}
      feedback={<FeedbackMenuItems />}
      side={from === "footer" ? "top" : "right"}
      settingsShortcut={PgCommon.getOS() === "MacOS" ? "⌘," : "Ctrl+,"}
      onPick={pick}
      signOut={shownSignOut}
      onSignOutConfirm={signOut}
      onSignOutCancel={cancelSignOut}
      page={page}
    />
  );

  return {
    account,
    pick,
    menu,
    onMenuOpenChange,
    accountRef: triggerRef,
  };
};
