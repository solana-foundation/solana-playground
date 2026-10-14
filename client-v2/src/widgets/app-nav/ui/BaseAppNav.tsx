import { Code, GraduationCap, House, PanelLeft, Plus } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { Button } from "@/shared/ui/button";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import type { NavItem } from "../model/nav-item";

/** Keyed by item so a new `NavItem` without an entry does not compile; the
 * menu lists them in the order written here */
const ITEMS: Record<NavItem, { label: string; Icon: ComponentType }> = {
  home: { label: "Home", Icon: House },
  "new-project": { label: "New project", Icon: Plus },
  tutorials: { label: "Tutorials", Icon: GraduationCap },
  programs: { label: "Programs", Icon: Code },
};

const ORDER = Object.keys(ITEMS) as NavItem[];

export interface BaseAppNavProps {
  /** The rail: icons only, no logo or switcher, `railFooter` for `footer` */
  collapsed: boolean;
  onToggle: () => void;
  logo: ReactNode;
  switcher: ReactNode;
  footer: ReactNode;
  /** The footer's few icons the 52 px rail has room for, in its place */
  railFooter: ReactNode;
  onOpen: (item: NavItem) => void;
}

const BaseAppNav = ({
  collapsed,
  onToggle,
  logo,
  switcher,
  footer,
  railFooter,
  onOpen,
}: BaseAppNavProps) => (
  <>
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
      {!collapsed && switcher}
    </SidebarHeader>
    <SidebarContent>
      <SidebarMenu>
        {ORDER.map((item) => {
          const { label, Icon } = ITEMS[item];
          return (
            <SidebarMenuItem key={item}>
              <SidebarMenuButton tooltip={label} onClick={() => onOpen(item)}>
                <Icon />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarContent>
    {/* Swapped, not hidden, on the rail: what the full footer holds keeps
        its state above it (`FeedbackHost`, `PgSession`), as it must anyway
        for the stock Sidebar's Sheet, which unmounts it on close below
        `LAYOUT_BREAKPOINTS.left` */}
    <SidebarFooter>
      {collapsed ? (
        railFooter
      ) : (
        <div className="flex flex-wrap items-center gap-2">{footer}</div>
      )}
    </SidebarFooter>
  </>
);

export default BaseAppNav;
