import ProgramsSkeleton from "./Component/ProgramsSkeleton";
import programsIcon from "../icons/programs.svg";
import { createSidebarPage } from "../create";

export const programs = createSidebarPage({
  name: "Programs",
  icon: programsIcon,
  keybind: "Ctrl+Shift+P",
  route: "/programs",
  LoadingComponent: ProgramsSkeleton,
});
