import { useEffect, useState } from "react";

import { PgCommon, PgTheme } from "@/utils";

/**
 * The current playground theme, for the code that needs its values in
 * JavaScript (Monaco options, xterm, font sizes). It replaces
 * styled-components' `useTheme`, so a component reads the theme without
 * the styled context, and re-renders when the theme or font changes.
 */
export const usePgTheme = () => {
  const [theme, setTheme] = useState(() => PgTheme.theme);

  useEffect(() => {
    return PgCommon.batchChanges(
      () => setTheme(PgTheme.theme),
      [PgTheme.onDidChangeThemeName, PgTheme.onDidChangeFontFamily]
    ).dispose;
  }, []);

  return theme;
};
