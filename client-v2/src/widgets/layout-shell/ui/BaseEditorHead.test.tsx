import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
        title={props.title}
        onNewFile={props.onNewFile}
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

describe("the tree's dropdown", () => {
  const tree = (choice: { open?: boolean; canDock?: boolean }) => ({
    open: choice.open ?? true,
    canDock: choice.canDock ?? true,
    onClose: vi.fn(),
    onDock: vi.fn(),
    onClick: vi.fn(),
    body: <div>tree body</div>,
  });
  const drawWithTree = (dropdown: ReturnType<typeof tree>) =>
    render(
      <TooltipProvider>
        <BaseEditorHead
          files={{ open: dropdown.open, onToggle: vi.fn() }}
          terminal={closed()}
          showTabs
          hostRef={vi.fn()}
          filesKey="⌘E"
          terminalKey="⌘J"
          tree={dropdown}
          onNewFile={vi.fn()}
        />
        {/* Stands for a menu the tree opened, portalled out of it */}
        <div role="menu">
          <button type="button">Rename</button>
        </div>
        <button type="button">Elsewhere</button>
      </TooltipProvider>
    );

  it("shows the body under the head, named Files, with the pin", async () => {
    const dropdown = tree({});
    drawWithTree(dropdown);
    const sheet = screen.getByRole("dialog", { name: "Files" });
    expect(within(sheet).getByText("tree body")).toBeTruthy();
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Dock beside the editor" })
    );
    expect(dropdown.onDock).toHaveBeenCalledTimes(1);
  });

  it("hands a click inside it to the caller, by what it landed on", async () => {
    const dropdown = tree({});
    drawWithTree(dropdown);
    const body = screen.getByText("tree body");
    await userEvent.click(body);
    expect(dropdown.onClick).toHaveBeenCalledWith(body);
  });

  it("offers no pin while the code area is too narrow to dock", () => {
    drawWithTree(tree({ canDock: false }));
    const sheet = screen.getByRole("dialog", { name: "Files" });
    expect(
      within(sheet).queryByRole("button", { name: "Dock beside the editor" })
    ).toBeNull();
  });

  it("draws nothing while closed", () => {
    drawWithTree(tree({ open: false }));
    expect(screen.queryByRole("dialog", { name: "Files" })).toBeNull();
    expect(screen.queryByText("tree body")).toBeNull();
  });

  it("stays open for a press in a menu it opened, on Files or on New file, and closes for one elsewhere", async () => {
    const dropdown = tree({});
    drawWithTree(dropdown);
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.click(screen.getByRole("button", { name: "Files" }));
    await userEvent.click(screen.getByRole("button", { name: "New file" }));
    expect(dropdown.onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(dropdown.onClose).toHaveBeenCalledTimes(1);
  });
});

const withTabs = (showTabs: boolean) => ({
  files: closed(),
  terminal: closed(),
  showTabs,
  hostRef: vi.fn(),
  filesKey: "Ctrl+E",
  terminalKey: "Ctrl+J",
  onNewFile: vi.fn(),
});

it("calls onNewFile from the + after the tabs", async () => {
  const props = withTabs(true);
  draw(props);
  await userEvent.click(screen.getByRole("button", { name: "New file" }));
  expect(props.onNewFile).toHaveBeenCalledTimes(1);
});

it("draws no + while the tab row is hidden", () => {
  draw(withTabs(false));
  expect(screen.queryByRole("button", { name: "New file" })).toBeNull();
});

it("names the project only when given a title", () => {
  const { rerender } = draw(withTabs(true));
  expect(headElement().textContent).not.toContain("anchor-demo");
  rerender(
    <TooltipProvider>
      <BaseEditorHead
        files={closed()}
        terminal={closed()}
        showTabs
        hostRef={vi.fn()}
        filesKey="Ctrl+E"
        terminalKey="Ctrl+J"
        title="anchor-demo"
      />
    </TooltipProvider>
  );
  expect(headElement().textContent).toContain("anchor-demo");
});
