import { PgView } from "@/utils";
import NewWorkspaceModal from "@/views/flow/gallery/NewWorkspaceModal";
import type { NavItem } from "../model/nav-item";
import { navTelemetry } from "../model/telemetry";
import BaseAppNav from "./BaseAppNav";
import type { BaseAppNavProps } from "./BaseAppNav";

/** The items that open a page of their own */
export type NavPage = Extract<NavItem, "tutorials" | "programs">;

export type AppNavProps = Omit<BaseAppNavProps, "onOpen" | "current"> & {
  /** Home was picked; the page decides what that does where it is */
  onHome: () => void;
  /** The page shown, if any; its item is marked current */
  current?: NavPage;
  /** Home shows; its item is marked current when no page covers it */
  homeShown: boolean;
  onOpenPage: (page: NavPage) => void;
  onClosePage: () => void;
  /**
   * Makes way for what the navigation opens over the work: on a phone it
   * brings Work into view, so a project the gallery starts is not behind the
   * menu page
   */
  closeSheet: () => void;
};

/**
 * Home goes to the page (`onHome`), which closes a page that shows and then
 * shows Home, keeps it, or over a shared project goes back to the work.
 * Tutorials and Programs open their pages. New project closes a page that
 * shows, leaves the navigation (`closeSheet`) and opens the gallery.
 */
const AppNav = ({
  onHome,
  current,
  homeShown,
  onOpenPage,
  onClosePage,
  closeSheet,
  ...props
}: AppNavProps) => {
  const open = (item: NavItem) => {
    navTelemetry.track("nav_item_opened", { item });
    if (item === "home") {
      onHome();
      return;
    }
    if (item === "tutorials" || item === "programs") {
      onOpenPage(item);
      return;
    }
    // The pick leaves the page whether or not a project follows: the
    // gallery takes the user's attention from it
    if (current) onClosePage();
    closeSheet();
    // Settles when the modal closes and never rejects: a gallery that fails
    // to render is reported and told by `ModalHost`'s boundary
    void PgView.setModal(NewWorkspaceModal);
  };

  const marked = current ?? (homeShown ? "home" : undefined);
  return <BaseAppNav {...props} current={marked} onOpen={open} />;
};

export default AppNav;
