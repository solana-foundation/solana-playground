import { PgView } from "@/utils";
import NewWorkspaceModal from "@/views/flow/gallery/NewWorkspaceModal";
import type { GalleryTab } from "@/views/flow/gallery/NewWorkspaceModal";
import type { NavItem } from "../model/nav-item";
import { navTelemetry } from "../model/telemetry";
import BaseAppNav from "./BaseAppNav";
import type { BaseAppNavProps } from "./BaseAppNav";

export type AppNavProps = Omit<BaseAppNavProps, "onOpen"> & {
  /** Home is the page shown, so picking Home has nowhere further to go */
  homeShown?: boolean;
};

/** Which gallery tab each item opens on; Home and New project take the lead tab */
const TAB: Record<NavItem, GalleryTab> = {
  home: "tutorials",
  "new-project": "tutorials",
  tutorials: "tutorials",
  programs: "programs",
};

/**
 * New project, Tutorials and Programs open the gallery on their tab. Home has
 * a page now, but the navigation cannot bring it back once the work shows:
 * while Home shows (`homeShown`) its item does nothing, and otherwise (a
 * project open, the start still pending, or the work shown as a fallback) it
 * opens the gallery as the others do.
 */
const AppNav = ({ homeShown, ...props }: AppNavProps) => {
  const open = (item: NavItem) => {
    navTelemetry.track("nav_item_opened", { item });
    if (item === "home" && homeShown) return;
    // Settles when the modal closes and never rejects: a gallery that fails
    // to render is reported and told by `ModalHost`'s boundary
    void PgView.setModal<unknown, { initialTab: GalleryTab }>(
      NewWorkspaceModal,
      { initialTab: TAB[item] }
    );
  };

  return <BaseAppNav {...props} onOpen={open} />;
};

export default AppNav;
