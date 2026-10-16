import type { ITheme } from "xterm";

import type { Theme } from "../../utils/theme";

type XtermStyles = Theme["components"]["terminal"]["xterm"];

/**
 * xterm's colours from the theme. xterm paints on its own and cannot read
 * CSS variables, so every value goes through `resolve` (`resolveColor` in
 * the app) against the current `<html>`.
 */
export const xtermTheme = (
  xterm: XtermStyles,
  resolve: (value: string) => string
): ITheme => ({
  foreground: resolve(xterm.textPrimary),
  brightBlack: resolve(xterm.textSecondary),
  black: resolve(xterm.textSecondary),
  brightMagenta: resolve(xterm.primary),
  brightCyan: resolve(xterm.secondary),
  brightGreen: resolve(xterm.success),
  brightRed: resolve(xterm.error),
  brightYellow: resolve(xterm.warning),
  brightBlue: resolve(xterm.info),
  selection: resolve(xterm.selectionBg),
  cursor: resolve(xterm.cursor.color),
  cursorAccent: resolve(xterm.cursor.accentColor),
});
