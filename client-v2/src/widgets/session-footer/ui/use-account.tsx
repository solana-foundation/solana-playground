import { useRef, useState } from "react";

import { connectWallet } from "@/commands/connect/connect-wallet";
import { isSetupRejected } from "@/commands/connect/setup-rejected";
import { isDeletionFailure, isSignInFailure, PgSession } from "@/features/auth";
import { FeedbackMenuItems, useFeedbackSend } from "@/features/feedback";
import { openFundDialog } from "@/features/fund-wallet";
import { useBalance, useRenderOnChange, useWallet } from "@/hooks";
import { useOnline } from "@/shared/lib/hooks/use-online";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import type { SettingsRequest } from "@/shared/lib/settings-request";
import { PgCommon, PgExplorer, PgView, PgWallet } from "@/utils";
import { ExportWorkspace } from "@/views/sidebar/explorer/Component/Modals/ExportWorkspace";

import type {
  AccountItem,
  AccountSession,
  AccountSurface,
  AccountView,
  DeleteAccountState,
  SignOutState,
} from "../model/account";
import {
  ACCOUNT_DELETED,
  DELETE_ACCOUNT_FAILED,
  DELETE_ACCOUNT_RETRY,
  GITHUB_APPLICATIONS_URL,
  leftoversText,
  REVOKE_AT_GITHUB,
  sessionWith,
  shownDeleteAccountState,
  shownSignOutState,
} from "../model/account";
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

/**
 * A deletion that succeeded behind a closed menu, GitHub's grant revoked,
 * with the leftovers line when projects stayed
 */
const toastAccountDeleted = (kept: number) =>
  PgView.setToast(
    () => (
      <span>
        <strong>{ACCOUNT_DELETED}</strong> {leftoversText(kept)}
      </span>
    ),
    { options: { name: "account-deleted" } }
  );

/** A deletion that succeeded behind a closed menu, GitHub's grant left standing */
const toastRevokeAtGithub = (kept: number) =>
  PgView.setToast(
    () => (
      <span>
        <strong>{ACCOUNT_DELETED}</strong> {leftoversText(kept)}{" "}
        <a
          href={GITHUB_APPLICATIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {REVOKE_AT_GITHUB}
        </a>
      </span>
    ),
    { options: { name: "account-deleted-revoke" } }
  );

/** A deletion that failed behind a closed menu; still signed in */
const toastDeleteFailed = (reason: string) =>
  PgView.setToast(
    () => (
      <span>
        <strong>{DELETE_ACCOUNT_FAILED}</strong> {reason}
      </span>
    ),
    { options: { name: "account-delete-failed" } }
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
  const [deleteState, setDeleteState] = useState<DeleteAccountState>({
    status: "idle",
  });
  // The deletion under way: counted when it ends, never as a cancel
  const deleting = useRef<Promise<void> | undefined>(undefined);
  // The question's busy item already stops a second press; this stops a
  // second question (the footer and the rail swap) from starting another
  const signingOut = useRef<Promise<void> | null>(null);
  // Whether the menu is open, for a sign-out that settles after a close
  const menuOpen = useRef(false);

  const user = PgSession.get();
  // A session wins over the sign-in state: a sign-in may still wait here on a
  // popup when the session arrives from another tab
  const session: AccountSession = user
    ? {
        status: "signed-in",
        user: { name: user.name, login: user.login, image: user.image },
      }
    : sessionWith(PgSession.expiredUser)(PgSession.signInState());
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
    canFund: PgWallet.accounts.length > 0,
  };

  // `connect` toggles: no wallet to the Playground wallet, the Playground
  // wallet to none, an extension wallet back to the Playground one. It
  // rejects when the user closes the setup, which is their choice, not a fault.
  // Home mounts no terminal, so this must work without one
  const toggleWallet = (item: AccountItem) => {
    connectWallet().catch((error: unknown) => {
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
    "privacy-policy": () => undefined,
    "sign-out": () => setSignOutState({ status: "asking" }),
    "delete-account": () => setDeleteState({ status: "asking" }),
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
    // The one Fund dialog, mounted beside the toasts, outlives the menu closing
    "fund-wallet": () => openFundDialog("account-menu"),
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
      sessionTelemetry.track("session_account_menu_opened", { via: from });
      return;
    }
    // A sign-out under way is counted when it ends, not as a cancel; it
    // settles into a closed menu, which `signOut` sees
    if (signOutState.status === "asking" && !signingOut.current) {
      cancelSignOut();
      return;
    }
    // Likewise the deletion; a question left open after a refusal is a cancel
    if (
      (deleteState.status === "asking" || deleteState.status === "failed") &&
      !deleting.current
    ) {
      handleDeleteAccountCancel();
      return;
    }
    if (deleteState.status === "done") {
      setDeleteState({ status: "idle" });
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
        // holds without this browser's latest edits. The stored names, which
        // a temporary view lists too
        const kept = PgExplorer.storedWorkspaceNames?.length ?? 0;
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

  /** The deletion question closed unanswered: its Cancel, or the menu closing over it */
  const handleDeleteAccountCancel = () => {
    sessionTelemetry.track("session_delete_account_ended", {
      outcome: "cancelled",
    });
    setDeleteState({ status: "idle" });
  };

  const handleDeleteAccount = () => {
    // The question's busy item stops a second press; this stops a second
    // question (the footer and the rail swap) from starting another
    if (deleting.current) return;
    setDeleteState({ status: "running" });
    deleting.current = PgSession.deleteAccount()
      .then(({ githubRevoked, kept }) => {
        sessionTelemetry.track("session_delete_account_ended", {
          outcome: "ok",
        });
        // Said in the menu that deleted, never in one opened later. The
        // GitHub line and the leftovers line go with it: the person can still
        // remove the app there, and what stayed is still here. Closed over
        // meanwhile, what the menu would say is a toast, since nothing else
        // would ever say it
        if (menuOpen.current) {
          setDeleteState({ status: "done", githubRevoked, kept });
          return;
        }
        setDeleteState({ status: "idle" });
        if (githubRevoked) toastAccountDeleted(kept);
        else toastRevokeAtGithub(kept);
      })
      .catch((error: unknown) => {
        // `PgSession.deleteAccount` has logged and reported a refusal; the
        // reason is the person's to read. Anything else is a defect of ours.
        // Closed over meanwhile, the menu opens on its items next time
        if (isDeletionFailure(error)) {
          log.info("account deletion failed; still signed in", {
            context: { reason: error.reason, status: error.status },
          });
        } else {
          log.error(error, {
            report: true,
            context: { item: "delete-account" },
          });
        }
        const reason = isDeletionFailure(error)
          ? error.message
          : DELETE_ACCOUNT_RETRY;
        if (menuOpen.current) {
          setDeleteState({ status: "failed", reason });
          return;
        }
        setDeleteState({ status: "idle" });
        toastDeleteFailed(reason);
      })
      .finally(() => {
        deleting.current = undefined;
      });
  };

  // The export dialog the explorer and the project list open, for the open project
  const handleExportProject = () => {
    PgView.setModal(ExportWorkspace).catch(
      reportButtonFailure("export this project")
    );
  };

  const shownDelete = shownDeleteAccountState(deleteState, {
    signedIn: !!user,
  });

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
      deleteAccount={shownDelete}
      onDeleteAccountConfirm={handleDeleteAccount}
      onDeleteAccountCancel={handleDeleteAccountCancel}
      onExportProject={handleExportProject}
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
