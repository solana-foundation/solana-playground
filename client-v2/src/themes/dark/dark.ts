import { createTheme } from "../create";

export const dark = createTheme({
  name: "Dark",
  isDark: true,
  isDefault: true,
  import: () => import("../palette"),
});
