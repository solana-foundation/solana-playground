import { createSidebarPage } from "../create";
import testIcon from "../icons/test.svg";
import TestSkeleton from "./Component/TestSkeleton";

export const test = createSidebarPage({
  name: "Test",
  icon: testIcon,
  keybind: "Ctrl+Shift+D",
  LoadingComponent: TestSkeleton,
});
