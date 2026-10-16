import { createSidebarPage } from "../create";
import assistantIcon from "./assistant.svg";

export const assistant = createSidebarPage({
  name: "Assistant",
  icon: assistantIcon,
  keybind: "Ctrl+Shift+A",
});
