import type { ReactNode, Ref } from "react";

import { DropdownMenu, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { Spinner } from "@/shared/ui/spinner";

import type { AccountView } from "../model/account";
import { accountLabel, accountUser } from "../model/account";
import AccountAvatar from "./AccountAvatar";
import RailUser from "./RailUser";

export interface BaseRailFooterProps {
  account: AccountView;
  /** The status row's icons with their state dots (`widgets/status`), over the account */
  status: ReactNode;
  /** The account menu's content, opened beside the rail */
  menu: ReactNode;
  onMenuOpenChange: (open: boolean) => void;
  /** Where the feedback form returns focus */
  accountRef?: Ref<HTMLButtonElement>;
}

/**
 * The account on the rail: the photo when there is one, else a plain user
 * glyph drawn as the rail's status icons are, with no circle of its own
 */
const RailAccount = ({ image }: { image: string | undefined }) =>
  image ? (
    <AccountAvatar image={image} sending={false} className="size-4" />
  ) : (
    <RailUser />
  );

/**
 * The navigation's footer on the rail: the status icons and the account,
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
                  <RailAccount image={accountUser(account)?.image} />
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
