import type { ITheme } from "xterm";

import type { Theme } from "../../utils/theme";

type XtermStyles = Theme["components"]["terminal"]["xterm"];

/**
 * xterm's colours from the theme. xterm paints on its own and cannot read
 * CSS variables, so every value goes through `resolve` (`resolveColor` in
 * the app) against the current `<html>`. The ground is the console well
 * (`--surface-well`) and the cursor is `--success`, both from the design
 * system rather than the theme's `terminal.xterm` block, whose `cursor.color`
 * and `cursor.accentColor` are therefore inert.
 */
export const xtermTheme = (
  xterm: XtermStyles,
  resolve: (value: string) => string
): ITheme => ({
  background: resolve("var(--surface-well)"),
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
  cursor: resolve("var(--success)"),
  cursorAccent: resolve("var(--surface-well)"),
});

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("components/Terminal/terminal-theme", () => {
    const xterm = {
      textPrimary: "var(--text-primary)",
      textSecondary: "var(--text-secondary)",
      primary: "var(--primary)",
      secondary: "var(--track-brand)",
      success: "var(--success)",
      error: "var(--error)",
      warning: "var(--warning)",
      info: "var(--info)",
      selectionBg: "var(--surface-hover)",
      cursor: {
        color: "var(--text-primary)",
        accentColor: "var(--surface-base)",
        blink: true,
        kind: "block" as const,
      },
    };

    describe("xtermTheme", () => {
      it("resolves every colour xterm draws with", () => {
        const resolve = vi.fn((v: string) => `resolved(${v})`);

        expect(xtermTheme(xterm, resolve)).toEqual({
          background: "resolved(var(--surface-well))",
          foreground: "resolved(var(--text-primary))",
          brightBlack: "resolved(var(--text-secondary))",
          black: "resolved(var(--text-secondary))",
          brightMagenta: "resolved(var(--primary))",
          brightCyan: "resolved(var(--track-brand))",
          brightGreen: "resolved(var(--success))",
          brightRed: "resolved(var(--error))",
          brightYellow: "resolved(var(--warning))",
          brightBlue: "resolved(var(--info))",
          selection: "resolved(var(--surface-hover))",
          cursor: "resolved(var(--success))",
          cursorAccent: "resolved(var(--surface-well))",
        });
      });
    });
  });
}
