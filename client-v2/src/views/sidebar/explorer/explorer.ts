import { createSidebarPage } from "../create";
import explorerIcon from "../icons/explorer.svg";
import ExplorerSkeleton from "./Component/ExplorerSkeleton";

export const explorer = createSidebarPage({
  name: "Explorer",
  icon: explorerIcon,
  keybind: "Ctrl+Shift+E",
  LoadingComponent: ExplorerSkeleton,
});
