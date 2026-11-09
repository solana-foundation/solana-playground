import type { ReactNode } from "react";

import type { NavItem } from "../model/nav-item";
import { navTelemetry } from "../model/telemetry";
import type { BaseAppNavProps } from "./BaseAppNav";
import BaseAppNav from "./BaseAppNav";
import Handoff from "./Handoff";

/** The items that open a page of their own: all but Home */
export type NavPage = Exclude<NavItem, "home">;

export type AppNavProps = Omit<
  BaseAppNavProps,
  "onOpen" | "current" | "projects"
> & {
  /**
   * The project list, given the items' own open, so the empty list's ways
   * in (EMPTY-01) go where New project and Tutorials go
   */
  projects: (open: (item: NavItem) => void) => ReactNode;
  /** Home was picked; the page decides what that does where it is */
  onHome: () => void;
  /** The page shown, if any; its item is marked current */
  current?: NavPage;
  /** Home shows; its item is marked current when no page covers it */
  homeShown: boolean;
  onOpenPage: (page: NavPage) => void;
};

/**
 * Home goes to the page (`onHome`), which closes a page that shows and then
 * shows Home, keeps it, or over a shared project goes back to the work.
 * New project, Tutorials and Programs open their pages.
 */
const AppNav = ({
  onHome,
  current,
  homeShown,
  onOpenPage,
  projects,
  ...props
}: AppNavProps) => {
  const open = (item: NavItem) => {
    navTelemetry.track("nav_item_opened", { item });
    if (item === "home") {
      onHome();
      return;
    }
    onOpenPage(item);
  };

  const marked = current ?? (homeShown ? "home" : undefined);
  return (
    <BaseAppNav
      {...props}
      projects={projects(open)}
      handoff={props.phone ? <Handoff /> : undefined}
      current={marked}
      onOpen={open}
    />
  );
};

export default AppNav;
