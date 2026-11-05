import type { ComponentProps } from "react";

import { useIsMobile } from "@/shared/lib/hooks/use-mobile";
import { SETTINGS_TRIGGER_ATTR } from "@/shared/lib/settings-request";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";

import type { StatusIndicator } from "../model/indicators";
import { IndicatorDot, StatusPanel } from "./parts";

export interface BaseStatusRowProps {
  /** Network, AI, Rust analyzer, in that order */
  indicators: readonly StatusIndicator[];
  /** An indicator was clicked: one without a panel acts on it at once, one
   * with a panel has just opened it */
  onPick: (indicator: StatusIndicator) => void;
  /** A panel's action */
  onAction: (indicator: StatusIndicator) => void;
  /** A panel's Try again; busy until it settles */
  onRetry: (indicator: StatusIndicator) => Promise<unknown>;
  /** Whether the settings are open: the network indicator opens them */
  settingsOpen: boolean;
}

/** The settings' trigger mark, on the indicator that opens them */
const settingsTrigger = { [SETTINGS_TRIGGER_ATTR]: "" };

/**
 * The navigation foot's status row: the three indicators where the
 * prototype draws "● Devnet", one per line, on Get set up's grid above
 * them. An indicator with something to add (`panel`: the analyzer, a cluster
 * that does not answer, the AI's limit or failure) opens a panel beside the
 * navigation, or over its line on a phone, where the navigation fills the
 * screen and beside it is off the edge; the rest go straight to where they
 * are fixed.
 */
const BaseStatusRow = ({
  indicators,
  onPick,
  onAction,
  onRetry,
  settingsOpen,
}: BaseStatusRowProps) => {
  const isMobile = useIsMobile();
  return (
    <SidebarMenu className="w-full">
      <SidebarMenuItem
        data-testid="status-row"
        // A little more room before the account row than between the lines
        className="flex flex-col pb-2"
      >
        {indicators.map((indicator) => {
          const button = (props: ComponentProps<typeof SidebarMenuButton>) => (
            <SidebarMenuButton
              key={indicator.id}
              aria-label={indicator.label}
              title={indicator.label}
              data-status={indicator.id}
              data-state-kind={indicator.state}
              // On Get set up's grid above: the dot in its circles' 14 px column
              // (centre 23 px), the words on its labels' edge (40 px)
              className="w-full min-w-0 gap-2.5 px-2"
              {...props}
            >
              <IndicatorDot state={indicator.state} className="size-3.5" />
              <span className="truncate">{indicator.words}</span>
            </SidebarMenuButton>
          );

          if (!indicator.panel) {
            if (indicator.id === "network") {
              return button({
                "aria-expanded": settingsOpen,
                ...settingsTrigger,
                onClick: () => onPick(indicator),
              });
            }
            return button({ onClick: () => onPick(indicator) });
          }
          return (
            <StatusPanel
              key={indicator.id}
              indicator={indicator}
              // The settings' focus return still finds the network's trigger
              // when Change network opens them from the panel
              trigger={button({
                type: "button",
                ...(indicator.id === "network" && settingsTrigger),
              })}
              // Beside the navigation, level with the line's foot: 16 px off
              // the full-width line clears the sidebar's edge by 7 px. Over
              // the line on a phone, where beside it is off the screen
              side={isMobile ? "top" : "right"}
              align={isMobile ? "start" : "end"}
              sideOffset={isMobile ? 8 : 16}
              onPick={onPick}
              onAction={onAction}
              onRetry={onRetry}
            />
          );
        })}
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

export default BaseStatusRow;
