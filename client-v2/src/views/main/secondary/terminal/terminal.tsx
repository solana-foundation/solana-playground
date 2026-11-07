import { Icon } from "@/shared/ui/icon";

import { PgTerminal } from "../../../../utils";
import { createMainSecondaryPage } from "../create";

export const terminal = createMainSecondaryPage({
  name: "Terminal",
  getIsFocused: PgTerminal.isFocused,
  focus: PgTerminal.focus,
  actions: [
    {
      name: "Clear",
      keybind: "Ctrl+L",
      icon: <Icon name="clear" size={16} />,
      run: PgTerminal.clear,
    },
  ],
});
