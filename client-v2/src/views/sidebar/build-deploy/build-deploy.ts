import { createSidebarPage } from "../create";
import buildIcon from "../icons/build.svg";

export const buildDeploy = createSidebarPage({
  name: "Build & Deploy",
  icon: buildIcon,
  keybind: "Ctrl+Shift+B",
});
