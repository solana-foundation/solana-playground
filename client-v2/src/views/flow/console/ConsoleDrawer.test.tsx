import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import type { DefaultTheme } from "styled-components";
import { expect, it, vi } from "vitest";

import ConsoleDrawer from "./ConsoleDrawer";

vi.mock("../../main/secondary/terminal/Component/Terminal", () => ({
  default: () => <div className="xterm" />,
}));

// The `@/utils` barrel reaches generated globals (`GLOBAL_SETTINGS`) that
// exist only in a booted app; the drawer's imports pull it in, so it is empty.
vi.mock("@/utils", () => ({}));

// The real theme needs the `@/utils` barrel, which cannot load here; this is
// a stand-in with only the keys ConsoleDrawer's styles read.
const theme = {
  default: { borderRadius: "4px" },
  colors: {
    default: {
      border: "var(--border)",
      bgSecondary: "var(--surface-raised)",
      primary: "var(--primary)",
      textPrimary: "var(--text-primary)",
      textSecondary: "var(--text-secondary)",
    },
    state: { error: { color: "var(--error)" } },
  },
  font: { code: { family: "monospace", size: { small: "1" } } },
} as unknown as DefaultTheme;

it("should show what it is told and ask to toggle", () => {
  const onToggle = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <ConsoleDrawer open={false} onToggle={onToggle} />
    </ThemeProvider>
  );
  const handle = screen.getByRole("button", { name: "Console" });
  expect(handle.getAttribute("aria-expanded")).toBe("false");
  expect(
    document.querySelector("#flow-console-drawer-body .xterm")
  ).not.toBeNull();
  fireEvent.click(handle);
  expect(onToggle).toHaveBeenCalledTimes(1);
});

it("should report itself expanded when open", () => {
  render(
    <ThemeProvider theme={theme}>
      <ConsoleDrawer open={true} onToggle={vi.fn()} />
    </ThemeProvider>
  );
  const handle = screen.getByRole("button", { name: "Console" });
  expect(handle.getAttribute("aria-expanded")).toBe("true");
});
