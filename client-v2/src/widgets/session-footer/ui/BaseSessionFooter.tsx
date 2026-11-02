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
  accountLabel,
  accountLines,
  accountUser,
  lineText,
} from "../model/account";
import AccountAvatar from "./AccountAvatar";

const LINE_STYLE: Record<AccountLine["kind"], string> = {
  "saved-here": "text-muted-foreground",
  "signing-in": "text-muted-foreground",
  failed: "text-destructive",
  login: "text-muted-foreground",
  offline: "text-muted-foreground",
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
                // The prototype's 40 px account row, under the 28 px rows; on
                // a phone a fingertip tall in the body type, its avatar at 32
                className="h-10 text-[0.8125rem] max-md:h-12 max-md:gap-3 max-md:text-body max-md:[&_[data-slot=avatar]]:size-8 max-md:[&_[data-slot=avatar-fallback]_svg]:size-4"
                aria-label={accountLabel(account)}
                aria-busy={account.sending || undefined}
              >
                <AccountAvatar
                  image={accountUser(account)?.image}
                  sending={account.sending}
                />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-medium text-foreground">
                    {primary}
                  </span>
                  {line && (
                    <span
                      // A failure is announced; its reason is in full in the menu
                      role={line.kind === "failed" ? "status" : undefined}
                      title={line.kind === "failed" ? line.message : undefined}
                      className={cn("truncate text-xs", LINE_STYLE[line.kind])}
                    >
                      {lineText(line)}
                    </span>
                  )}
                </span>
                {account.sending ? (
                  <Spinner aria-label="Sending feedback" className="ml-auto" />
                ) : (
                  <ChevronsUpDown
                    aria-hidden
                    className="ml-auto text-muted-foreground"
                  />
                )}
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            {menu}
          </DropdownMenu>
          {account.session.status === "pending" && (
            // The popup cannot be asked whether it is still open once GitHub has
            // taken it over, so this is the way out short of the ten-minute
            // timeout -- see `popup-channel.ts`
            <SidebarMenuAction
              onClick={onCancelSignIn}
              className="aspect-auto w-auto px-1.5 text-xs"
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
