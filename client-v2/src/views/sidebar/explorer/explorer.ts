import ExplorerSkeleton from "./Component/ExplorerSkeleton";
import explorerIcon from "../icons/explorer.svg";
import { createSidebarPage } from "../create";

export const explorer = createSidebarPage({
  name: "Explorer",
  icon: explorerIcon,
  keybind: "Ctrl+Shift+E",
  LoadingComponent: ExplorerSkeleton,
});
