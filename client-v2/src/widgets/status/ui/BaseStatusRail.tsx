import { SETTINGS_TRIGGER_ATTR } from "@/shared/lib/settings-request";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { StatusDot } from "@/shared/ui/status-dot";

import type { BaseStatusRowProps } from "./BaseStatusRow";
import { DOT, StatusPanel } from "./parts";

/**
 * The status row on the rail: the three dots, one button each, doing what
 * their indicators do in the row (a panel where the indicator has one, else
 * the settings or Connect a model). The rail has no room for words,
 * so each dot's tooltip, on hover and on focus, says the indicator and its
 * state in the row's words.
 */
const BaseStatusRail = ({
  indicators,
  onPick,
  onAction,
  onRetry,
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

      if (indicator.panel) {
        return (
          <SidebarMenuItem key={indicator.id}>
            <StatusPanel
              indicator={indicator}
              trigger={
                <SidebarMenuButton
                  {...common}
                  {...(indicator.id === "network" && {
                    [SETTINGS_TRIGGER_ATTR]: "",
                  })}
                >
                  {dot}
                </SidebarMenuButton>
              }
              side="right"
              align="end"
              onPick={onPick}
              onAction={onAction}
              onRetry={onRetry}
            />
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
