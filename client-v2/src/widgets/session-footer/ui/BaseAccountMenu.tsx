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
  X,
} from "lucide-react";

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/shared/ui/dropdown-menu";
import { SETTINGS_TRIGGER_ATTR } from "@/shared/lib/settings-request";
import { cn } from "@/shared/lib/utils";
import { shortAddress } from "@/shared/lib/short-address";
import {
  DOCS_URL,
  formatBalance,
  githubProfileUrl,
  profileName,
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
  /**
   * A phone's page, as the prototype draws the account there: the whole
   * screen, titled, with a close, its rows a fingertip tall and, signed out,
   * Sign in with GitHub pinned at the foot with what signing in is for
   */
  page?: boolean;
}

/** Picks that open the settings, which take focus as they open */
const MOVES_FOCUS: ReadonlySet<AccountItem> = new Set([
  "settings",
  "cluster-down",
]);

/**
 * Picks that, from a phone's page, leave it for the wallet window over the
 * work: they wait for the menu to close too, so its focus goes where the pick
 * sends it, not back to a trigger the menu page took with it
 */
const LEAVES_PAGE: ReadonlySet<AccountItem> = new Set([
  "wallet",
  "connect-wallet",
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
  page,
}: Pick<BaseAccountMenuProps, "account" | "onPick" | "page">) => {
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
      {/* On a page, signing in is the foot's (`SignInFoot`) */}
      {!page && (
        <DropdownMenuItem onSelect={() => onPick("sign-in")}>
          <GithubMark className="size-4" /> Sign in with GitHub
        </DropdownMenuItem>
      )}
    </>
  );
};

/** Whether the page's foot offers signing in: signed out, no sign-in under way */
const signsIn = (account: AccountView) =>
  account.session.status === "idle" || account.session.status === "failed";

/** The page's foot while signed out: what signing in is for, and the button */
const SignInFoot = ({ onPick }: Pick<BaseAccountMenuProps, "onPick">) => {
  // The page covers the account row it opened from, and this button sits
  // where that row was: the finger that opened the page lifts over it, and a
  // menu item takes a release with no press on it for a pick (Radix's drag
  // to select). That release is not a pick here.
  const pressed = useRef(false);
  const stray = useRef(false);
  return (
    <div
      data-account-foot=""
      className="flex shrink-0 flex-col gap-3 border-t border-border px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
    >
      <p className="text-control font-read text-muted-foreground">
        Keep your projects and conversations on every device, and request devnet
        SOL.
      </p>
      <DropdownMenuItem
        onPointerDown={() => {
          pressed.current = true;
        }}
        onPointerUp={() => {
          stray.current = !pressed.current;
          pressed.current = false;
        }}
        // A press that slid off or was taken by a scroll ended elsewhere
        onPointerLeave={() => {
          pressed.current = false;
        }}
        onPointerCancel={() => {
          pressed.current = false;
        }}
        onSelect={(ev) => {
          const wasStray = stray.current;
          stray.current = false;
          if (wasStray) {
            ev.preventDefault();
            return;
          }
          onPick("sign-in");
        }}
        className="h-12 justify-center gap-2 rounded-xl bg-foreground text-body font-act text-background focus:bg-foreground/90 focus:text-background not-data-[variant=destructive]:focus:**:text-background [&_svg]:size-5"
      >
        <GithubMark className="text-background" /> Sign in with GitHub
      </DropdownMenuItem>
    </div>
  );
};

/**
 * The page's rows, as the prototype's phone rows: a fingertip tall in the
 * body type, icons at 20, rules across the whole page, and no key hints:
 * a phone has no keyboard to press them on. Set from here, on
 * the DS items inside, so the desktop menu keeps the DS sizes
 */
const PAGE_ROWS =
  "[&_[data-slot=dropdown-menu-item]]:min-h-12 [&_[data-slot=dropdown-menu-item]]:gap-3 [&_[data-slot=dropdown-menu-item]]:rounded-xl [&_[data-slot=dropdown-menu-item]]:px-3 [&_[data-slot=dropdown-menu-item]]:text-body [&_[data-slot=dropdown-menu-item]]:font-read [&_[data-slot=dropdown-menu-item]>svg:first-child]:size-5! [&_[data-slot=dropdown-menu-shortcut]]:hidden [&_[data-slot=dropdown-menu-separator]]:-mx-2 [&_[data-slot=dropdown-menu-separator]]:my-1.5";

/** The account menu's content, opened from the footer's account row or the rail's "Account" */
const BaseAccountMenu = ({
  account,
  feedback,
  side,
  settingsShortcut,
  onPick,
  page = false,
}: BaseAccountMenuProps) => {
  const { cluster, wallet } = account;
  // A pick that opens the settings waits for the menu to close: while the
  // menu is mounted its focus trap pulls back the focus the settings take as
  // they open, and as it closes it puts focus back on its trigger
  const deferred = useRef<AccountItem | null>(null);
  const pick = (item: AccountItem) => {
    if (MOVES_FOCUS.has(item) || (page && LEAVES_PAGE.has(item)))
      deferred.current = item;
    else onPick(item);
  };
  const items = (
    <>
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
      <SessionItems account={account} onPick={pick} page={page} />
      {/* Signed out, a page's sign-in is its foot: nothing to rule off,
          unless a failure is said above */}
      {!(page && account.session.status === "idle") && (
        <DropdownMenuSeparator />
      )}
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
    </>
  );
  const closeAfterPick = (ev: Event) => {
    const item = deferred.current;
    if (!item) return;
    deferred.current = null;
    ev.preventDefault();
    onPick(item);
  };
  if (page) {
    return (
      <DropdownMenuContent
        data-account-page=""
        aria-label="Account"
        // A page, not a popup: `index.css` stops the popper placing it
        className="fixed inset-0 flex h-dvh max-h-none w-screen min-w-0 flex-col overflow-hidden rounded-none bg-background p-0 text-body text-foreground shadow-none ring-0"
        onCloseAutoFocus={closeAfterPick}
      >
        <div className="flex h-phone-bar shrink-0 items-center justify-between gap-2 border-b border-border pr-2 pl-5">
          {/* The menu is named by its trigger; this is the page's title */}
          <h2
            aria-hidden="true"
            className="truncate text-title font-act text-foreground"
          >
            Account
          </h2>
          <DropdownMenuItem
            aria-label="Close"
            className="size-12 justify-center rounded-xl p-0 text-muted-foreground [&_svg]:size-6!"
          >
            <X strokeWidth={1.6} />
          </DropdownMenuItem>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2 pb-4",
            PAGE_ROWS
          )}
        >
          {items}
        </div>
        {signsIn(account) && <SignInFoot onPick={pick} />}
      </DropdownMenuContent>
    );
  }
  return (
    <DropdownMenuContent
      side={side}
      align={side === "top" ? "start" : "end"}
      sideOffset={8}
      // Above the row it is as wide as the row, as the prototype draws it;
      // beside the 52 px rail it needs a width of its own
      className={side === "right" ? "min-w-56" : undefined}
      aria-label="Account"
      onCloseAutoFocus={closeAfterPick}
    >
      {items}
    </DropdownMenuContent>
  );
};

export default BaseAccountMenu;
