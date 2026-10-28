import { useRef } from "react";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  HandCoins,
  LogOut,
  Settings,
  TriangleAlert,
  Unplug,
  Wallet,
} from "lucide-react";

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/shared/ui/dropdown-menu";
import { SETTINGS_TRIGGER_ATTR } from "@/shared/lib/settings-request";
import {
  DOCS_URL,
  formatBalance,
  githubProfileUrl,
  profileName,
  shortAddress,
} from "../model/account";
import type { AccountItem, AccountView } from "../model/account";
import AccountAvatar from "./AccountAvatar";
import GithubMark from "./GithubMark";

export interface BaseAccountMenuProps {
  account: AccountView;
  /** The feedback entries, from `features/feedback` */
  feedback: ReactNode;
  /** `top` above the footer's account row, `right` beside the rail */
  side: "top" | "right";
  /** "⌘," on macOS, "Ctrl+," elsewhere */
  settingsShortcut: string;
  onPick: (item: AccountItem) => void;
}

/** Picks that open the settings, which take focus as they open */
const MOVES_FOCUS: ReadonlySet<AccountItem> = new Set([
  "settings",
  "cluster-down",
]);

/** Marks the items that open the settings, as tests find them */
const settingsTrigger = { [SETTINGS_TRIGGER_ATTR]: "" };

const External = () => (
  <ArrowUpRight aria-hidden className="ml-auto text-muted-foreground" />
);

/** The session group: sign in, a sign-in under way, or the signed-in profile */
const SessionItems = ({
  account,
  onPick,
}: Pick<BaseAccountMenuProps, "account" | "onPick">) => {
  const { session } = account;
  if (session.status === "signed-in") {
    const { user } = session;
    return (
      <>
        <DropdownMenuLabel className="flex items-center gap-2 font-normal">
          <AccountAvatar
            image={user.image}
            sending={false}
            className="size-8"
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-foreground">
              {profileName(user)}
            </span>
            {user.login && (
              <span className="truncate text-xs text-muted-foreground">
                @{user.login}
              </span>
            )}
          </span>
        </DropdownMenuLabel>
        {user.login && (
          <DropdownMenuItem asChild>
            <a
              href={githubProfileUrl(user.login)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onPick("github-profile")}
            >
              <GithubMark className="size-4" /> Open GitHub profile
              <External />
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onPick("sign-out")}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </>
    );
  }
  if (session.status === "pending") {
    return (
      <>
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          Signing in...
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onPick("cancel-sign-in")}>
          Cancel
        </DropdownMenuItem>
      </>
    );
  }
  // The reason is said in full here: the row has room for "Couldn't sign
  // in" only, and the rail for nothing at all
  const failure =
    session.status === "failed" && session.reason !== "cancelled"
      ? session.message
      : null;
  return (
    <>
      {failure && (
        <DropdownMenuLabel className="font-normal text-destructive">
          {failure}
        </DropdownMenuLabel>
      )}
      <DropdownMenuItem onSelect={() => onPick("sign-in")}>
        <GithubMark className="size-4" /> Sign in with GitHub
      </DropdownMenuItem>
    </>
  );
};

/** The account menu's content, opened from the footer's account row or the rail's "Account" */
const BaseAccountMenu = ({
  account,
  feedback,
  side,
  settingsShortcut,
  onPick,
}: BaseAccountMenuProps) => {
  const { cluster, wallet } = account;
  // A pick that opens the settings waits for the menu to close: while the
  // menu is mounted its focus trap pulls back the focus the settings take as
  // they open, and as it closes it puts focus back on its trigger
  const deferred = useRef<AccountItem | null>(null);
  const pick = (item: AccountItem) => {
    if (MOVES_FOCUS.has(item)) deferred.current = item;
    else onPick(item);
  };
  return (
    <DropdownMenuContent
      side={side}
      align={side === "top" ? "start" : "end"}
      sideOffset={8}
      // Above the row it is as wide as the row, as the prototype draws it;
      // beside the 52 px rail it needs a width of its own
      className={side === "right" ? "min-w-56" : undefined}
      aria-label="Account"
      onCloseAutoFocus={(ev) => {
        const item = deferred.current;
        if (!item) return;
        deferred.current = null;
        ev.preventDefault();
        onPick(item);
      }}
    >
      {cluster.down && (
        <>
          <DropdownMenuItem
            variant="destructive"
            {...settingsTrigger}
            onSelect={() => pick("cluster-down")}
          >
            <TriangleAlert /> {cluster.name} is not answering
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <SessionItems account={account} onPick={pick} />
      <DropdownMenuSeparator />
      <DropdownMenuItem {...settingsTrigger} onSelect={() => pick("settings")}>
        <Settings /> Settings
        <DropdownMenuShortcut>{settingsShortcut}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => pick("docs")}
        >
          <BookOpen /> Docs
          <External />
        </a>
      </DropdownMenuItem>
      {feedback}
      <DropdownMenuSeparator />
      {wallet ? (
        <>
          <DropdownMenuItem onSelect={() => pick("wallet")}>
            <Wallet />
            <span className="font-mono">{shortAddress(wallet.address)}</span>
            <span className="ml-auto text-success">
              {formatBalance(wallet.balance)}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pick("disconnect-wallet")}>
            <Unplug /> Disconnect {wallet.name ?? "wallet"}
          </DropdownMenuItem>
        </>
      ) : (
        <DropdownMenuItem onSelect={() => pick("connect-wallet")}>
          <Wallet /> Connect wallet
        </DropdownMenuItem>
      )}
      {account.canFund && (
        <DropdownMenuItem onSelect={() => pick("fund-wallet")}>
          <HandCoins /> Fund from a wallet
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
};

export default BaseAccountMenu;
