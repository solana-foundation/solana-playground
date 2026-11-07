import type { ReactNode, Ref } from "react";

import { DropdownMenu, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { Spinner } from "@/shared/ui/spinner";

import type { AccountView } from "../model/account";
import { accountImage, accountLabel } from "../model/account";
import AccountAvatar from "./AccountAvatar";

export interface BaseRailFooterProps {
  account: AccountView;
  /** The status row's dots (`widgets/status`), over the account */
  status: ReactNode;
  /** The account menu's content, opened beside the rail */
  menu: ReactNode;
  onMenuOpenChange: (open: boolean) => void;
  /** Where the feedback form returns focus */
  accountRef?: Ref<HTMLButtonElement>;
}

/**
 * The navigation's footer on the rail: the status dots and the account,
 * each an icon, as the prototype draws them. "Account" opens the same menu
 * as the footer's account row, beside the rail.
 */
const BaseRailFooter = ({
  account,
  status,
  menu,
  onMenuOpenChange,
  accountRef,
}: BaseRailFooterProps) => {
  return (
    <div className="flex flex-col gap-1">
      {status}
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu onOpenChange={onMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                ref={accountRef}
                tooltip="Account"
                aria-label={accountLabel(account)}
                aria-busy={account.sending || undefined}
                className="justify-center"
              >
                {account.sending ? (
                  // The rail has no room for both: the spinner says it, as the
                  // footer's row does beside the avatar
                  <Spinner aria-label="Sending feedback" />
                ) : (
                  <AccountAvatar
                    image={accountImage(account)}
                    sending={false}
                    className="size-4"
                  />
                )}
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            {menu}
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
};

export default BaseRailFooter;
