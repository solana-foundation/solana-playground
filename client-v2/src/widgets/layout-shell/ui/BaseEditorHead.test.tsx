import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

import type { BaseEditorHeadProps } from "./BaseEditorHead";
import BaseEditorHead from "./BaseEditorHead";

/** The head's element; a test that cannot find it says so */
const headElement = () => {
  const el = document.getElementById("editor-head");
  if (!el) throw new Error("no #editor-head");
  return el;
};

// A click hovers first, which opens the button's tooltip; Radix measures it
// with a ResizeObserver, which jsdom lacks
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterEach(() => vi.unstubAllGlobals());

const draw = (props: BaseEditorHeadProps) =>
  render(
    <TooltipProvider>
      <BaseEditorHead
        files={props.files}
        terminal={props.terminal}
        showTabs={props.showTabs}
        hostRef={props.hostRef}
        filesKey={props.filesKey}
        terminalKey={props.terminalKey}
      />
    </TooltipProvider>
  );

const closed = () => ({ open: false, onToggle: vi.fn() });

it("marks each toggle pressed while its panel is open", () => {
  draw({
    files: { open: true, onToggle: vi.fn() },
    terminal: closed(),
    showTabs: true,
    hostRef: vi.fn(),
    filesKey: "Ctrl+E",
    terminalKey: "Ctrl+J",
  });
  const files = screen.getByRole("button", { name: "Files" });
  const terminal = screen.getByRole("button", { name: "Terminal" });
  expect(files.id).toBe("editor-head-files");
  expect(terminal.id).toBe("editor-head-terminal");
  expect(files.getAttribute("aria-pressed")).toBe("true");
  expect(terminal.getAttribute("aria-pressed")).toBe("false");
});

it("calls each toggle's onToggle on click", async () => {
  const files = closed();
  const terminal = closed();
  draw({
    files,
    terminal,
    showTabs: true,
    hostRef: vi.fn(),
    filesKey: "Ctrl+E",
    terminalKey: "Ctrl+J",
  });
  await userEvent.click(screen.getByRole("button", { name: "Files" }));
  expect(files.onToggle).toHaveBeenCalledTimes(1);
  expect(terminal.onToggle).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Terminal" }));
  expect(terminal.onToggle).toHaveBeenCalledTimes(1);
});

it("is the 44 px head with a bottom line, its toggles 32 px with an 8 px radius", () => {
  draw({
    files: closed(),
    terminal: closed(),
    showTabs: true,
    hostRef: vi.fn(),
    filesKey: "Ctrl+E",
    terminalKey: "Ctrl+J",
  });
  const head = headElement();
  expect(head.className).toContain("h-11");
  expect(head.className).toContain("border-b");
  const files = screen.getByRole("button", { name: "Files" });
  expect(files.className).toContain("size-8");
  expect(files.className).toContain("rounded-lg");
});

it.each([
  [true, false],
  [false, true],
])(
  "hands the tab row's host to hostRef, hidden unless showTabs (showTabs %s)",
  (showTabs, hidden) => {
    const hostRef = vi.fn();
    draw({
      files: closed(),
      terminal: closed(),
      showTabs,
      hostRef,
      filesKey: "Ctrl+E",
      terminalKey: "Ctrl+J",
    });
    const host = hostRef.mock.calls.find(([el]) => el !== null)?.[0];
    expect(host).toBeInstanceOf(HTMLElement);
    expect(headElement().contains(host)).toBe(true);
    expect((host as HTMLElement).hidden).toBe(hidden);
  }
);

it("names the keys in the toggles' hints", async () => {
  draw({
    files: closed(),
    terminal: closed(),
    showTabs: true,
    hostRef: vi.fn(),
    filesKey: "⌘E",
    terminalKey: "⌘J",
  });
  await userEvent.hover(screen.getByRole("button", { name: "Terminal" }));
  expect((await screen.findAllByText("Terminal (⌘J)")).length).toBeGreaterThan(
    0
  );
  await userEvent.hover(screen.getByRole("button", { name: "Files" }));
  expect((await screen.findAllByText("Files (⌘E)")).length).toBeGreaterThan(0);
});
