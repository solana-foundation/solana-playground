import { PanelLeft, X } from "lucide-react";
import type { ReactNode } from "react";

import { BrandIcon } from "@/shared/ui/brand-icon";
import type { BrandIconName } from "@/shared/ui/brand-icon";
import { Button } from "@/shared/ui/button";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import type { NavItem } from "../model/nav-item";

/** Keyed by item so a new `NavItem` without an entry does not compile; the
 * menu lists them in the order written here. The icons are the prototype's,
 * cut from the mark (`BrandIcon`) */
const ITEMS: Record<NavItem, { label: string; icon: BrandIconName }> = {
  home: { label: "Home", icon: "home" },
  "new-project": { label: "New project", icon: "new" },
  tutorials: { label: "Tutorials", icon: "tutorial" },
  programs: { label: "Programs", icon: "programs" },
};

const ORDER = Object.keys(ITEMS) as NavItem[];

export interface BaseAppNavProps {
  /**
   * The phone's menu page: the head is the logo and a close (`onToggle`), as
   * the prototype draws it, and there is no rail to fold to
   */
  phone?: boolean;
  /** The rail: icons only, no logo or project list, `railFooter` for `footer` */
  collapsed: boolean;
  onToggle: () => void;
  logo: ReactNode;
  /** The project list, under the items; the rail has no room for it */
  projects: ReactNode;
  footer: ReactNode;
  /** The footer's few icons the 52 px rail has room for, in its place */
  railFooter: ReactNode;
  /** The Get set up checklist, at the foot of the content; not on the rail */
  setup: ReactNode;
  onOpen: (item: NavItem) => void;
  /** The item whose page shows, marked as the current one */
  current?: NavItem;
}

const BaseAppNav = ({
  phone = false,
  collapsed,
  onToggle,
  logo,
  projects,
  footer,
  railFooter,
  setup,
  onOpen,
  current,
}: BaseAppNavProps) => (
  <>
    {phone ? (
      // The prototype's phone head: 60 tall, the logo at the left, a close
      // the size of a fingertip at the right
      <SidebarHeader className="h-phone-bar shrink-0 flex-row items-center justify-between gap-2 border-b border-sidebar-border py-0 pr-2 pl-5">
        {logo}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close the menu"
          // Where focus goes when the control it left is gone (Flow's
          // `fallbackFocus`), as the work page's Menu is while this shows
          data-sidebar="trigger"
          onClick={onToggle}
          className="size-12 rounded-xl"
        >
          <X className="size-6" strokeWidth={1.6} aria-hidden />
        </Button>
      </SidebarHeader>
    ) : (
      <SidebarHeader>
        <div className="flex items-center justify-between gap-2">
          {!collapsed && logo}
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={onToggle}
          >
            <PanelLeft />
          </Button>
        </div>
      </SidebarHeader>
    )}
    <SidebarContent>
      {/* In a group, as the DS sidebar expects: its padding insets every
          row 8 px from the column's edges, as the prototype draws them */}
      <SidebarGroup className={phone ? "pt-3" : undefined}>
        <SidebarMenu className="gap-px">
          {ORDER.map((item) => {
            const { label, icon } = ITEMS[item];
            return (
              <SidebarMenuItem key={item}>
                <SidebarMenuButton
                  tooltip={label}
                  isActive={item === current}
                  onClick={() => onOpen(item)}
                >
                  <BrandIcon name={icon} />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
        {!collapsed && projects}
      </SidebarGroup>
      {!collapsed && <div className="mt-auto">{setup}</div>}
    </SidebarContent>
    {/* Swapped, not hidden, on the rail: what the full footer holds keeps
        its state above it (`FeedbackHost`, `PgSession`), as it must anyway
        across `LAYOUT_BREAKPOINTS.phone`, where the pager and the frame
        replace each other's tree */}
    <SidebarFooter className="border-t border-sidebar-border px-2 pt-1.5 pb-2">
      {collapsed ? (
        railFooter
      ) : (
        <div className="flex flex-wrap items-center gap-2">{footer}</div>
      )}
    </SidebarFooter>
  </>
);

export default BaseAppNav;
