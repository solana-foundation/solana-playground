import { createLogger } from "@/shared/lib/logger";
import { PgView } from "@/utils";
import NewWorkspaceModal from "@/views/flow/gallery/NewWorkspaceModal";
import type { GalleryTab } from "@/views/flow/gallery/NewWorkspaceModal";
import type { NavItem } from "../model/nav-item";
import { navTelemetry } from "../model/telemetry";
import BaseAppNav from "./BaseAppNav";
import type { BaseAppNavProps } from "./BaseAppNav";

export type AppNavProps = Omit<BaseAppNavProps, "onOpen">;

const log = createLogger("app-nav:open");

/** Which gallery tab each item opens on; Home and New project take the lead tab */
const TAB: Record<NavItem, GalleryTab> = {
  home: "tutorials",
  "new-project": "tutorials",
  tutorials: "tutorials",
  programs: "programs",
};

/** Until Home, Tutorials and Programs have pages, each item opens the gallery */
const AppNav = (props: AppNavProps) => {
  const open = (item: NavItem) => {
    navTelemetry.track("nav_item_opened", { item });
    // The promise settles when the modal closes; only a failure to open it
    // is news
    PgView.setModal<unknown, { initialTab: GalleryTab }>(NewWorkspaceModal, {
      initialTab: TAB[item],
    }).catch((e: unknown) => {
      log.error(e, { report: true, context: { item } });
    });
  };

  return <BaseAppNav {...props} onOpen={open} />;
};

export default AppNav;
