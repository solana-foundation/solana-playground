import buildIcon from "../icons/build.svg";
import { createSidebarPage } from "../create";

export const buildDeploy = createSidebarPage({
  name: "Build & Deploy",
  icon: buildIcon,
  keybind: "Ctrl+Shift+B",
});
