import { SETTINGS_TRIGGER_ATTR } from "@/shared/lib/settings-request";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/shared/ui/popover";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { StatusDot } from "@/shared/ui/status-dot";

import type { BaseStatusRowProps } from "./BaseStatusRow";
import { DOT, StatusDetail } from "./parts";

/**
 * The status row on the rail: the three dots, one button each, doing what
 * their indicators do in the row. The names carry the words the rail has no
 * room for, and show as tooltips.
 */
const BaseStatusRail = ({
  indicators,
  onPick,
  onAction,
  settingsOpen,
}: BaseStatusRowProps) => (
  <SidebarMenu data-testid="status-rail">
    {indicators.map((indicator) => {
      const dot = <StatusDot variant={DOT[indicator.state]} size="lg" />;
      const common = {
        "aria-label": indicator.railLabel,
        "data-status": indicator.id,
        "data-state-kind": indicator.state,
        className: "justify-center",
      };

      if (indicator.id === "rust") {
        return (
          <SidebarMenuItem key={indicator.id}>
            <Popover onOpenChange={(open) => open && onPick(indicator)}>
              <PopoverTrigger asChild>
                <SidebarMenuButton tooltip={indicator.railLabel} {...common}>
                  {dot}
                </SidebarMenuButton>
              </PopoverTrigger>
              <PopoverContent side="right" align="end" className="w-72">
                <PopoverHeader>
                  <PopoverTitle>{indicator.name}</PopoverTitle>
                  <PopoverDescription>{indicator.words}</PopoverDescription>
                </PopoverHeader>
                <StatusDetail indicator={indicator} onAction={onAction} />
              </PopoverContent>
            </Popover>
          </SidebarMenuItem>
        );
      }
      return (
        <SidebarMenuItem key={indicator.id}>
          <SidebarMenuButton
            tooltip={indicator.railLabel}
            {...common}
            {...(indicator.id === "network" && {
              "aria-expanded": settingsOpen,
              // Tests and the settings' focus return find it by this
              [SETTINGS_TRIGGER_ATTR]: "",
            })}
            onClick={() => onPick(indicator)}
          >
            {dot}
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    })}
  </SidebarMenu>
);

export default BaseStatusRail;
