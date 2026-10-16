import type { ReactNode, Ref } from "react";

import { DropdownMenu, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { Spinner } from "@/shared/ui/spinner";
import { StatusDot } from "@/shared/ui/status-dot";
import { SETTINGS_TRIGGER_ATTR } from "@/views/flow/settings/GearSidebar";
import { accountLabel, accountUser, clusterLabel } from "../model/account";
import type { AccountView } from "../model/account";
import AccountAvatar from "./AccountAvatar";

export interface BaseRailFooterProps {
  account: AccountView;
  settingsOpen: boolean;
  /** Opens or closes the settings on the cluster, as the footer's row does */
  onOpenCluster: () => void;
  /** The account menu's content, opened beside the rail */
  menu: ReactNode;
  onMenuOpenChange: (open: boolean) => void;
  /** Where the feedback form returns focus */
  accountRef?: Ref<HTMLButtonElement>;
}

/**
 * The navigation's footer on the rail: the cluster's dot and the account,
 * each an icon, as the prototype draws them. "Account" opens the same menu
 * as the footer's account row, beside the rail.
 */
const BaseRailFooter = ({
  account,
  settingsOpen,
  onOpenCluster,
  menu,
  onMenuOpenChange,
  accountRef,
}: BaseRailFooterProps) => {
  const dotLabel = clusterLabel(account.cluster, "Cluster: ");
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={dotLabel}
          aria-label={dotLabel}
          aria-expanded={settingsOpen}
          // Lets the click through `GearSidebar`'s outside-click check, so a
          // second click closes the settings instead of reopening them
          {...{ [SETTINGS_TRIGGER_ATTR]: "" }}
          className="justify-center"
          onClick={onOpenCluster}
        >
          <StatusDot
            variant={account.cluster.down ? "error" : "success"}
            size="lg"
          />
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              ref={accountRef}
              tooltip="Account"
              aria-label={accountLabel(account)}
              aria-busy={account.sending || undefined}
              // Opening the menu is no click outside the settings: Settings
              // in it toggles them, so open settings must still be open then
              {...{ [SETTINGS_TRIGGER_ATTR]: "" }}
              className="justify-center"
            >
              {account.sending ? (
                // The rail has no room for both: the spinner says it, as the
                // footer's row does beside the avatar
                <Spinner aria-label="Sending feedback" />
              ) : (
                <AccountAvatar
                  image={accountUser(account)?.image ?? null}
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
  );
};

export default BaseRailFooter;
