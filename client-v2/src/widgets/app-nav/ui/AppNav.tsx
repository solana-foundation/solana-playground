import { PgView } from "@/utils";
import NewWorkspaceModal from "@/views/flow/gallery/NewWorkspaceModal";
import type { GalleryTab } from "@/views/flow/gallery/NewWorkspaceModal";
import type { NavItem } from "../model/nav-item";
import { navTelemetry } from "../model/telemetry";
import BaseAppNav from "./BaseAppNav";
import type { BaseAppNavProps } from "./BaseAppNav";

export type AppNavProps = Omit<BaseAppNavProps, "onOpen"> & {
  /** Home was picked; the page decides what that does where it is */
  onHome: () => void;
};

/** Which gallery tab each item opens on; New project takes the lead tab */
const TAB: Record<Exclude<NavItem, "home">, GalleryTab> = {
  "new-project": "tutorials",
  tutorials: "tutorials",
  programs: "programs",
};

/**
 * Home goes to the page (`onHome`), which shows Home, keeps it, or over a
 * shared project goes back to the work. New project, Tutorials and Programs
 * open the gallery on their tab until they get pages of their own.
 */
const AppNav = ({ onHome, ...props }: AppNavProps) => {
  const open = (item: NavItem) => {
    navTelemetry.track("nav_item_opened", { item });
    if (item === "home") {
      onHome();
      return;
    }
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
