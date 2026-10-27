import tutorialsIcon from "../icons/tutorials.svg";
import { createSidebarPage } from "../create";

// No component: the list is a page (`widgets/catalog`). The tutorial route
// still names this sidebar page (`handleTutorial`, its not-found branch)
export const tutorials = createSidebarPage({
  name: "Tutorials",
  icon: tutorialsIcon,
  keybind: "Ctrl+Shift+X",
  route: "/tutorials",
});
