import TutorialsSkeleton from "./Component/TutorialsSkeleton";
import tutorialsIcon from "../icons/tutorials.svg";
import { createSidebarPage } from "../create";

export const tutorials = createSidebarPage({
  name: "Tutorials",
  icon: tutorialsIcon,
  keybind: "Ctrl+Shift+X",
  route: "/tutorials",
  LoadingComponent: TutorialsSkeleton,
});
