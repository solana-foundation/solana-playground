import type { ComponentType } from "react";

import { SETTINGS_TRIGGER_ATTR } from "@/shared/lib/settings-request";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { StatusDot } from "@/shared/ui/status-dot";

import type { IndicatorId } from "../model/indicators";
import type { BaseStatusRowProps } from "./BaseStatusRow";
import { DOT, indicatorMark, StatusPanel, useFocusAfterPanel } from "./parts";
import type { GlyphProps } from "./rail-glyphs";
import { RailBrace, RailGlobe, RailStar } from "./rail-glyphs";

/** Each indicator's glyph on the rail, so three dots are not three alike */
const ICONS: Record<IndicatorId, ComponentType<GlyphProps>> = {
  network: RailGlobe,
  ai: RailStar,
  rust: RailBrace,
};

/**
 * The status row on the rail: an icon per indicator with its state dot on
 * the icon's corner, one button each, doing what their indicators do in the
 * row (a panel where the indicator has one, else the settings or Connect a
 * model). The rail has no room for words, and a touch screen shows no
 * tooltip, so the icon says which indicator it is; the tooltip, on hover and
 * on focus, says the indicator and its state in the row's words.
 */
const BaseStatusRail = ({
  indicators,
  onPick,
  onAction,
  onRetry,
  settingsOpen,
}: BaseStatusRowProps) => {
  const { ref, handleGone } = useFocusAfterPanel<HTMLUListElement>();
  return (
    <SidebarMenu ref={ref} data-testid="status-rail">
      {indicators.map((indicator) => {
        const Icon = ICONS[indicator.id];
        // The ring in the rail's colour cuts the dot out of the glyph's stroke.
        // The menu button truncates its last span, this one: `overflow-visible!`
        // keeps the dot whole past the glyph's corner
        const glyph = (
          <span className="relative grid size-4 shrink-0 place-items-center overflow-visible!">
            {/* 2.5 in the 24 box, about 1.7 px at 16 px: a touch lighter than
                the navigation's glyphs above, which are filled */}
            <Icon strokeWidth={2.5} className="size-4" />
            <StatusDot
              variant={DOT[indicator.state]}
              size="lg"
              className="absolute -right-0.5 -bottom-0.5 ring-2 ring-sidebar"
            />
          </span>
        );
        const common = {
          "aria-label": indicator.railLabel,
          ...indicatorMark(indicator.id),
          "data-state-kind": indicator.state,
          // A fingertip wide and tall on a touch screen (Spec 06,
          // "Accessibility"). The stock rail fixes its buttons at 32 px with an
          // important size under the same group selector, so the override
          // repeats it; the margin keeps the icon on the rail icons' centre line.
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
                    {glyph}
                  </SidebarMenuButton>
                }
                side="right"
                align="end"
                onPick={onPick}
                onAction={onAction}
                onRetry={onRetry}
                onGone={handleGone}
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
              {glyph}
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
};

export default BaseStatusRail;
