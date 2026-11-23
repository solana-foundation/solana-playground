import { ChevronsUpDown } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { cn } from "@/shared/lib/utils";
import { DropdownMenu, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { Spinner } from "@/shared/ui/spinner";

import type { AccountLine, AccountView } from "../model/account";
import {
  accountImage,
  accountLabel,
  accountLines,
  lineText,
} from "../model/account";
import AccountAvatar from "./AccountAvatar";

const LINE_STYLE: Record<AccountLine["kind"], string> = {
  "saved-here": "text-muted-foreground",
  "signing-in": "text-muted-foreground",
  failed: "text-destructive",
  login: "text-muted-foreground",
  offline: "text-muted-foreground",
  "session-ended": "text-warning-ink",
};

export interface BaseSessionFooterProps {
  account: AccountView;
  /** The status row (`widgets/status`), over the account row */
  status: ReactNode;
  onCancelSignIn: () => void;
  /** The account menu's content (`BaseAccountMenu`) */
  menu: ReactNode;
  onMenuOpenChange: (open: boolean) => void;
  /** Where the feedback form returns focus */
  accountRef?: Ref<HTMLButtonElement>;
}

/**
 * The navigation's foot, as the prototype draws it: the status row (which
 * cluster, the AI, the Rust analyzer), and who you are. The account row opens
 * the account menu.
 */
const BaseSessionFooter = ({
  account,
  status,
  onCancelSignIn,
  menu,
  onMenuOpenChange,
  accountRef,
}: BaseSessionFooterProps) => {
  const { primary, line } = accountLines(account);
  const pending = account.session.status === "pending";
  return (
    // The status row sits where the prototype draws "● Devnet"
    <div className="flex w-full flex-col gap-1">
      {status}
      <SidebarMenu className="w-full">
        <SidebarMenuItem>
          <DropdownMenu onOpenChange={onMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                ref={accountRef}
                size="lg"
                // The prototype's 40 px account row, under the 28 px rows: an
                // 22 px avatar centred on the status dots and Get set up's
                // circles (23 px), the name at 40 px with their words; on a
                // phone a fingertip tall in the body type, its avatar at 32
                // While signing in, Cancel sits on the row's right edge: the
                // default menu-action room (pr-8) is narrower than its word, so
                // the room is Cancel's width and a little air, and the line
                // truncates before it
                className={cn(
                  "h-10 gap-1.5 pl-1 text-[0.8125rem] [&_[data-slot=avatar]]:size-5.5 max-md:h-12 max-md:gap-3 max-md:pl-2 max-md:text-body max-md:[&_[data-slot=avatar]]:size-8",
                  pending &&
                    "group-has-data-[sidebar=menu-action]/menu-item:pr-15"
                )}
                aria-label={accountLabel(account)}
                aria-busy={account.sending || undefined}
              >
                <AccountAvatar
                  image={accountImage(account)}
                  sending={account.sending}
                />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-label text-foreground">
                    {primary}
                  </span>
                  {line && (
                    <span
                      // A failure or a session's end is announced; a failure's
                      // reason is in full in the menu
                      role={
                        line.kind === "failed" || line.kind === "session-ended"
                          ? "status"
                          : undefined
                      }
                      title={line.kind === "failed" ? line.message : undefined}
                      className={cn("truncate text-xs", LINE_STYLE[line.kind])}
                    >
                      {lineText(line)}
                    </span>
                  )}
                </span>
                {/* While signing in, Cancel is the row's trailing item: no
                    chevron under it. A send in flight keeps its spinner, which
                    sits left of the room kept for Cancel */}
                {account.sending ? (
                  <Spinner aria-label="Sending feedback" className="ml-auto" />
                ) : (
                  !pending && (
                    <ChevronsUpDown
                      aria-hidden
                      className="ml-auto text-muted-foreground"
                    />
                  )
                )}
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            {menu}
          </DropdownMenu>
          {pending && (
            // The popup cannot be asked whether it is still open once GitHub has
            // taken it over, so this is the way out short of the ten-minute
            // timeout -- see `popup-channel.ts`
            <SidebarMenuAction
              onClick={onCancelSignIn}
              // Centred on the row at either height (40 px, 48 px on a phone)
              className="aspect-auto w-auto px-1.5 text-xs peer-data-[size=lg]/menu-button:top-1/2 peer-data-[size=lg]/menu-button:-translate-y-1/2"
            >
              Cancel
            </SidebarMenuAction>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
};

export default BaseSessionFooter;
