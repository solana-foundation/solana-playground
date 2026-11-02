import type { ComponentProps } from "react";

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
import type { StatusIndicator } from "../model/indicators";
import { IndicatorDot, StatusDetail } from "./parts";

export interface BaseStatusRowProps {
  /** Network, AI, Rust analyzer, in that order */
  indicators: readonly StatusIndicator[];
  /** An indicator was clicked; the network and the AI act on it at once */
  onPick: (indicator: StatusIndicator) => void;
  /** The analyzer panel's action */
  onAction: (indicator: StatusIndicator) => void;
  /** Whether the settings are open: the network indicator opens them */
  settingsOpen: boolean;
}

/** The settings' trigger mark, on the indicator that opens them */
const settingsTrigger = { [SETTINGS_TRIGGER_ATTR]: "" };

/**
 * The navigation foot's status row: the three indicators where the
 * prototype draws "● Devnet", wrapping onto a second line when a state is
 * long rather than cutting its words. The network and the AI go straight to
 * where they are fixed; the analyzer, which has no settings, opens a panel.
 */
const BaseStatusRow = ({
  indicators,
  onPick,
  onAction,
  settingsOpen,
}: BaseStatusRowProps) => (
  <SidebarMenu className="w-full">
    <SidebarMenuItem
      data-testid="status-row"
      className="flex flex-wrap items-center"
    >
      {indicators.map((indicator) => {
        const button = (props: ComponentProps<typeof SidebarMenuButton>) => (
          <SidebarMenuButton
            key={indicator.id}
            aria-label={indicator.label}
            title={indicator.label}
            data-status={indicator.id}
            data-state-kind={indicator.state}
            // Tight, so a row of ready states fits the navigation on one line
            className="w-auto max-w-full min-w-0 gap-1.5 px-1"
            {...props}
          >
            <IndicatorDot state={indicator.state} />
            <span className="truncate">{indicator.words}</span>
          </SidebarMenuButton>
        );

        if (indicator.id === "network") {
          return button({
            "aria-expanded": settingsOpen,
            ...settingsTrigger,
            onClick: () => onPick(indicator),
          });
        }
        if (indicator.id === "ai") {
          return button({ onClick: () => onPick(indicator) });
        }
        return (
          <Popover
            key={indicator.id}
            onOpenChange={(open) => open && onPick(indicator)}
          >
            <PopoverTrigger asChild>{button({})}</PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-72">
              <PopoverHeader>
                <PopoverTitle>{indicator.name}</PopoverTitle>
                <PopoverDescription>{indicator.words}</PopoverDescription>
              </PopoverHeader>
              <StatusDetail indicator={indicator} onAction={onAction} />
            </PopoverContent>
          </Popover>
        );
      })}
    </SidebarMenuItem>
  </SidebarMenu>
);

export default BaseStatusRow;
