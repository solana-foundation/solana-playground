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
import { DOT, stateWords, StatusDetail } from "./parts";

/**
 * The status row on the rail: the three dots, one button each, doing what
 * their indicators do in the row (the network opens the settings, the AI
 * Connect a model, the analyzer its panel). The rail has no room for words,
 * so each dot's tooltip, on hover and on focus, says the indicator and its
 * state in the row's words.
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
        // A fingertip wide and tall on a touch screen (Spec 06,
        // "Accessibility"). The stock rail fixes its buttons at 32 px with an
        // important size under the same group selector, so the override
        // repeats it; the margin keeps the dot on the rail icons' centre line.
        className:
          "justify-center pointer-coarse:group-data-[collapsible=icon]:-ml-1.5 pointer-coarse:group-data-[collapsible=icon]:size-11!",
        tooltip: indicator.tip,
      };

      if (indicator.id === "rust") {
        return (
          <SidebarMenuItem key={indicator.id}>
            <Popover onOpenChange={(open) => open && onPick(indicator)}>
              <PopoverTrigger asChild>
                <SidebarMenuButton {...common}>{dot}</SidebarMenuButton>
              </PopoverTrigger>
              <PopoverContent side="right" align="end" className="w-72">
                <PopoverHeader>
                  <PopoverTitle>{indicator.name}</PopoverTitle>
                  <PopoverDescription>
                    {stateWords(indicator)}
                  </PopoverDescription>
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
