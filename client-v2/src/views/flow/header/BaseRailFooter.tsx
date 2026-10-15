import { CircleUserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";
import { StatusDot } from "@/shared/ui/status-dot";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SETTINGS_TRIGGER_ATTR } from "../settings/GearSidebar";
import type { ClusterStatus } from "./use-cluster-status";

export interface BaseRailFooterProps {
  cluster: ClusterStatus;
  settingsOpen: boolean;
  /** The signed-in user's avatar URL; `null` draws a generic user icon */
  avatar: string | null;
  /** Opens or closes the settings on the cluster, as the footer's chip does */
  onOpenCluster: () => void;
  onExpand: () => void;
}

/**
 * The navigation's footer on the rail: the cluster's dot and the account,
 * each an icon, as the prototype draws them. The rest of the footer (wallet,
 * sign-in, settings, feedback) is one click away, behind "Account".
 */
const BaseRailFooter = ({
  cluster,
  settingsOpen,
  avatar,
  onOpenCluster,
  onExpand,
}: BaseRailFooterProps) => {
  // Named, not only coloured, so a screen reader hears a cluster that is down
  const clusterLabel = cluster.down
    ? `Cluster: ${cluster.name}, down`
    : `Cluster: ${cluster.name}`;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={clusterLabel}
          aria-label={clusterLabel}
          aria-expanded={settingsOpen}
          // Lets the click through `GearSidebar`'s outside-click check, so a
          // second click closes the settings instead of reopening them
          {...{ [SETTINGS_TRIGGER_ATTR]: "" }}
          className="justify-center"
          onClick={onOpenCluster}
        >
          <StatusDot variant={cluster.down ? "error" : "success"} size="lg" />
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="Account"
          aria-label="Account"
          className="justify-center"
          onClick={onExpand}
        >
          <Avatar className="size-4">
            <AvatarImage src={avatar ?? undefined} alt="" />
            <AvatarFallback className="bg-transparent">
              <CircleUserRound aria-hidden />
            </AvatarFallback>
          </Avatar>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

export default BaseRailFooter;
