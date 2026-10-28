import type { ReactNode, Ref } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";

import { DropdownMenu, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { Spinner } from "@/shared/ui/spinner";
import { StatusDot } from "@/shared/ui/status-dot";
import { SETTINGS_TRIGGER_ATTR } from "@/shared/lib/settings-request";
import {
  accountLabel,
  accountLines,
  accountUser,
  clusterLabel,
  lineText,
} from "../model/account";
import type { AccountLine, AccountView } from "../model/account";
import AccountAvatar from "./AccountAvatar";

const LINE_STYLE: Record<AccountLine["kind"], string> = {
  "signing-in": "text-muted-foreground",
  failed: "text-destructive",
  wallet: "font-mono text-muted-foreground",
};

export interface BaseSessionFooterProps {
  account: AccountView;
  settingsOpen: boolean;
  /** Opens the settings on the cluster; the page covers the row while open */
  onOpenCluster: () => void;
  onCancelSignIn: () => void;
  /** The account menu's content (`BaseAccountMenu`) */
  menu: ReactNode;
  onMenuOpenChange: (open: boolean) => void;
  /** Where the feedback form returns focus */
  accountRef?: Ref<HTMLButtonElement>;
}

/**
 * The navigation's foot, as the prototype draws it: which cluster, and who
 * you are. Each row is one button; the account row opens the account menu.
 */
const BaseSessionFooter = ({
  account,
  settingsOpen,
  onOpenCluster,
  onCancelSignIn,
  menu,
  onMenuOpenChange,
  accountRef,
}: BaseSessionFooterProps) => {
  const { primary, lines } = accountLines(account);
  return (
    <SidebarMenu className="w-full">
      <SidebarMenuItem>
        <SidebarMenuButton
          aria-label={clusterLabel(
            account.cluster,
            "Change cluster, currently "
          )}
          aria-expanded={settingsOpen}
          // Tests find the controls that open the settings by it
          {...{ [SETTINGS_TRIGGER_ATTR]: "" }}
          onClick={onOpenCluster}
        >
          {/* In the 16 px glyph box every row's icon has, so its label
              lines up with theirs */}
          <span className="grid size-4 shrink-0 place-items-center">
            <StatusDot
              variant={account.cluster.down ? "error" : "success"}
              size="lg"
            />
          </span>
          {/* "Devnet", as the prototype writes it; the name stays lower case
              in the label the screen reader reads */}
          <span className="truncate capitalize">{account.cluster.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
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
                image={accountUser(account)?.image ?? null}
                sending={account.sending}
              />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate font-medium text-foreground">
                  {primary}
                </span>
                {lines.map((line) => (
                  <span
                    key={line.kind}
                    // A failure is announced; its reason is in full in the menu
                    role={line.kind === "failed" ? "status" : undefined}
                    title={line.kind === "failed" ? line.message : undefined}
                    className={cn("truncate text-xs", LINE_STYLE[line.kind])}
                  >
                    {lineText(line)}
                  </span>
                ))}
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
  );
};

export default BaseSessionFooter;
