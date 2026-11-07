import { PanelLeft, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";

import type { BrandIconName } from "@/shared/ui/brand-icon";
import { BrandIcon } from "@/shared/ui/brand-icon";
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
  /**
   * The rail: icons only, `railLogo` for `logo`, no project list,
   * `railFooter` for `footer`
   */
  collapsed: boolean;
  onToggle: () => void;
  logo: ReactNode;
  /**
   * The trimmed logo heading the rail, as the prototype draws it: pressing it
   * expands the navigation, so the rail needs no collapse icon of its own
   */
  railLogo: ReactNode;
  /** The project list, under the items; the rail has no room for it */
  projects: ReactNode;
  /**
   * The way to a computer, a menu row in its own group above `setup`: drawn
   * on the phone's menu page only, since from `LAYOUT_BREAKPOINTS.phone` up
   * this is the computer
   */
  handoff?: ReactNode;
  footer: ReactNode;
  /** The footer's few icons the 52 px rail has room for, in its place */
  railFooter: ReactNode;
  /** The Get set up checklist, at the foot of the content; not on the rail */
  setup: ReactNode;
  onOpen: (item: NavItem) => void;
  /** The item whose page shows, marked as the current one */
  current?: NavItem;
  /**
   * Before the fold button in the open head: in a tutorial, the pin that
   * docks the navigation open beside the chat (`widgets/tutorial-frame`)
   */
  pin?: ReactNode;
}

/**
 * The logo opens Home, as on most sites: `onOpen("home")`, as the Home item
 * does. The rail's logo expands the navigation instead; its Home item is the
 * way there
 */
const HomeLogo = ({
  logo,
  onOpen,
}: Pick<BaseAppNavProps, "logo" | "onOpen">) => (
  <button
    type="button"
    aria-label="Go to Home"
    onClick={() => onOpen("home")}
    // Dims a little on hover, as a link would, so the pointer is not the
    // only sign the logo can be pressed
    className="flex items-center rounded-md transition-opacity outline-none hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    {logo}
  </button>
);

const BaseAppNav = ({
  phone = false,
  collapsed,
  onToggle,
  logo,
  railLogo,
  projects,
  handoff,
  footer,
  railFooter,
  setup,
  onOpen,
  current,
  pin,
}: BaseAppNavProps) => {
  // The head's toggle is a different button folded and open, so pressing it
  // unmounts what held focus: hand focus to the one that replaces it, or a
  // keyboard user is left on the page's body. Only when the pressed button
  // had focus, so a click that gave it none takes none
  const toggleButton = useRef<HTMLButtonElement>(null);
  const handFocusOver = useRef(false);
  useEffect(() => {
    if (!handFocusOver.current) return;
    handFocusOver.current = false;
    toggleButton.current?.focus();
  }, [collapsed]);
  const handleHeadToggle = (event: MouseEvent<HTMLButtonElement>) => {
    handFocusOver.current = document.activeElement === event.currentTarget;
    onToggle();
  };

  return (
    <>
      {phone ? (
        // The prototype's phone head: 60 tall, the logo at the left, a close
        // the size of a fingertip at the right
        <SidebarHeader className="h-phone-bar shrink-0 flex-row items-center justify-between gap-2 border-b border-sidebar-border py-0 pr-2 pl-5">
          <HomeLogo logo={logo} onOpen={onOpen} />
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
        // 44 tall in both states, the height of the bars beside the nav, so
        // the first row starts at one y whether it is folded or not.
        // TODO(design-system): the kit's header
        <SidebarHeader className="h-11 shrink-0 justify-center py-0">
          {collapsed ? (
            // The prototype's rail head (`RailBrand`): the trimmed logo, which
            // turns into the fold glyph when pointed at or focused, as the
            // open column's collapse button wears it. Not the kit's Button,
            // which forces any svg without a `size-*` class to 16 px, the
            // mark's `w-7` included
            <button
              type="button"
              aria-label="Expand navigation"
              title="Expand navigation (⌘B)"
              ref={toggleButton}
              onClick={handleHeadToggle}
              className="group/rail-logo relative mx-auto grid size-9 place-items-center rounded-lg text-foreground transition-colors outline-none hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
            >
              <span className="grid place-items-center transition-opacity duration-120 group-hover/rail-logo:opacity-0 group-focus-visible/rail-logo:opacity-0 motion-reduce:transition-none">
                {railLogo}
              </span>
              <PanelLeft
                aria-hidden
                className="absolute inset-0 m-auto size-[18px] text-muted-foreground opacity-0 transition-opacity duration-120 group-hover/rail-logo:opacity-100 group-focus-visible/rail-logo:opacity-100 motion-reduce:transition-none"
                strokeWidth={1.6}
              />
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <HomeLogo logo={logo} onOpen={onOpen} />
              {pin && <div className="ml-auto flex">{pin}</div>}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Collapse navigation"
                title="Collapse navigation (⌘B)"
                ref={toggleButton}
                onClick={handleHeadToggle}
                // As the stage bar's icons: a 32 px square, 18 px at 1.6
                className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <PanelLeft className="size-[18px]" strokeWidth={1.6} />
              </Button>
            </div>
          )}
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
        <div className="mt-auto">
          {/* A group of its own at the foot, above Get set up: under the
            project list it read as one of the projects */}
          {phone && handoff && (
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>{handoff}</SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          )}
          {!collapsed && setup}
        </div>
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
};

export default BaseAppNav;
