import { describe, expect, it, vi } from "vitest";

import { xtermTheme } from "./terminal-theme";

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
      cursor: "resolved(var(--text-primary))",
      cursorAccent: "resolved(var(--surface-base))",
    });
  });
});
