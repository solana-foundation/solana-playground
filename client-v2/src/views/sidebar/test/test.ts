import TestSkeleton from "./Component/TestSkeleton";
import testIcon from "../icons/test.svg";
import { createSidebarPage } from "../create";

export const test = createSidebarPage({
  name: "Test",
  icon: testIcon,
  keybind: "Ctrl+Shift+D",
  LoadingComponent: TestSkeleton,
});
