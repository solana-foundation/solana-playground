import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";

// `usePanelRef` is replaced, so the tests can see which imperative calls the
// shell makes, and `Group` records its props; `Panel` and `Separator` are the
// library's own. Named one by one, so a new export of the library changes
// nothing here unseen. The refs ignore the library's own
// assignment to `current`, which would replace the spies.
const panelSpies = vi.hoisted(() => ({
  created: 0,
  groups: {} as Record<
    string,
    {
      defaultLayout?: unknown;
      onLayoutChanged?: (l: unknown, meta: unknown) => void;
    }
  >,
  handles: [] as Array<{
    collapse: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    isCollapsed: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock("react-resizable-panels", async (importOriginal) => {
  const real = await importOriginal<typeof import("react-resizable-panels")>();
  return {
    Panel: real.Panel,
    Separator: real.Separator,
    // Records each group's layout props by id, then renders the real group
    Group: (groupProps: {
      id?: string;
      defaultLayout?: unknown;
      onLayoutChanged?: (l: unknown, meta: unknown) => void;
    }) => {
      panelSpies.groups[groupProps.id ?? ""] = groupProps;
      return createElement(
        real.Group,
        groupProps as React.ComponentProps<typeof real.Group>
      );
    },
    usePanelRef: () => {
      const index = useRef(-1);
      if (index.current < 0) index.current = panelSpies.created++;
      const handle = panelSpies.handles[index.current];
      return useRef({
        get current() {
          return handle;
        },
        set current(_ignored: unknown) {},
      }).current;
    },
  };
});

import BaseLayoutShell, { PANEL_SIZES } from "./BaseLayoutShell";
import type { BaseLayoutShellProps } from "./BaseLayoutShell";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const desktopMatchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});
beforeEach(() => {
  panelSpies.created = 0;
  panelSpies.groups = {};
  panelSpies.handles = [0, 1].map(() => ({
    collapse: vi.fn(),
    resize: vi.fn(),
    isCollapsed: vi.fn(() => false),
  }));
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("matchMedia", desktopMatchMedia);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetLogger();
});

/** The fields a test sets itself; the rest are the defaults below */
interface PropsChoice {
  leftOpen?: boolean;
  assistantOpen?: boolean;
  assistantSheetOpen?: boolean;
  consoleOpen?: boolean;
  horizontal?: BaseLayoutShellProps["horizontal"];
}

const props = (
  viewport: BaseLayoutShellProps["viewport"],
  choice: PropsChoice = {}
): BaseLayoutShellProps => ({
  viewport,
  leftOpen: choice.leftOpen ?? true,
  onLeftOpenChange: vi.fn(),
  // One flag that follows the viewport: the panel on wide, the Sheet below
  assistantState: {
    open:
      viewport === "wide"
        ? choice.assistantOpen ?? true
        : choice.assistantSheetOpen ?? false,
    onOpenChange: vi.fn(),
  },
  consoleState: {
    open: choice.consoleOpen ?? false,
    onOpenChange: vi.fn(),
  },
  horizontal: choice.horizontal,
  vertical: undefined,
  onHorizontalLayout: vi.fn(),
  onVerticalLayout: vi.fn(),
  left: () => <nav>left slot</nav>,
  onLeftSheetChange: vi.fn(),
  closeLeftSheetOn: () => ({ dispose: () => {} }),
  stage: <main>stage slot</main>,
  console: <div className="xterm">console slot</div>,
  assistant: <section>assistant slot</section>,
  assistantOpener: <button type="button">Expand assistant</button>,
});

it("should lay out every slot on a wide screen", () => {
  render(<BaseLayoutShell {...props("wide")} />);
  for (const slot of [
    "left slot",
    "stage slot",
    "console slot",
    "assistant slot",
  ]) {
    expect(screen.getByText(slot)).toBeTruthy();
  }
  expect(document.querySelector('[data-slot="sidebar"]')).not.toBeNull();
  expect(
    document.querySelectorAll('[data-slot="resizable-panel-group"]')
  ).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Expand assistant" })).toBeNull();
});

it("should keep a folded console mounted", () => {
  render(<BaseLayoutShell {...props("wide")} />);
  expect(document.querySelector(".xterm")).not.toBeNull();
});

it("should put the assistant in a closed Sheet below 1024 px, with its opener", () => {
  render(<BaseLayoutShell {...props("compact")} />);
  expect(screen.queryByText("assistant slot")).toBeNull();
  expect(screen.getByRole("button", { name: "Expand assistant" })).toBeTruthy();
  expect(
    document.querySelectorAll('[data-slot="resizable-panel-group"]')
  ).toHaveLength(2);
});

it("should show the assistant Sheet when it is open", () => {
  const open = props("phone");
  render(
    <BaseLayoutShell
      viewport={open.viewport}
      leftOpen={open.leftOpen}
      onLeftOpenChange={open.onLeftOpenChange}
      assistantState={{
        open: true,
        onOpenChange: open.assistantState.onOpenChange,
      }}
      consoleState={open.consoleState}
      onHorizontalLayout={open.onHorizontalLayout}
      onVerticalLayout={open.onVerticalLayout}
      left={open.left}
      onLeftSheetChange={open.onLeftSheetChange}
      closeLeftSheetOn={open.closeLeftSheetOn}
      stage={open.stage}
      console={open.console}
      assistant={open.assistant}
      assistantOpener={open.assistantOpener}
    />
  );
  expect(screen.getByText("assistant slot")).toBeTruthy();
});

it("should set the design system's sidebar widths", () => {
  render(<BaseLayoutShell {...props("wide")} />);
  const wrapper = document.querySelector<HTMLElement>(
    '[data-slot="sidebar-wrapper"]'
  )!;
  expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("14.5rem");
  expect(wrapper.style.getPropertyValue("--sidebar-width-icon")).toBe(
    "3.25rem"
  );
});

it("should keep the console mounted when the window crosses 1024 px", () => {
  const { rerender } = render(<BaseLayoutShell {...props("wide")} />);
  const before = screen.getByText("console slot");
  rerender(<BaseLayoutShell {...props("compact")} />);
  expect(screen.getByText("console slot")).toBe(before);
  expect(screen.queryByText("assistant slot")).toBeNull();
});

it("should mark the sidebar expanded or collapsed from leftOpen", () => {
  const open = render(<BaseLayoutShell {...props("wide")} />);
  expect(
    document.querySelector('[data-slot="sidebar"]')!.getAttribute("data-state")
  ).toBe("expanded");
  open.unmount();
  render(<BaseLayoutShell {...props("wide", { leftOpen: false })} />);
  expect(
    document.querySelector('[data-slot="sidebar"]')!.getAttribute("data-state")
  ).toBe("collapsed");
});

it("should report the Sheet closing", () => {
  const shell = props("phone", { assistantSheetOpen: true });
  render(<BaseLayoutShell {...shell} />);
  const sheet = document.querySelector('[data-slot="sheet-content"]')!;
  fireEvent.keyDown(sheet, { key: "Escape" });
  expect(shell.assistantState.onOpenChange).toHaveBeenCalledWith(false);
});

it("should collapse the assistant panel when assistantOpen turns false", () => {
  const [assistant] = panelSpies.handles;
  const { rerender } = render(<BaseLayoutShell {...props("wide")} />);
  expect(assistant.collapse).not.toHaveBeenCalled();
  expect(assistant.resize).not.toHaveBeenCalled();
  rerender(<BaseLayoutShell {...props("wide", { assistantOpen: false })} />);
  expect(assistant.collapse).toHaveBeenCalledTimes(1);
});

it("should mount a folded assistant folded, and not report it open", () => {
  // Without a saved horizontal layout the panel starts at its folded size, so
  // nothing reads as the assistant having been opened
  const folded = props("wide", { assistantOpen: false });
  render(<BaseLayoutShell {...folded} />);
  expect(folded.assistantState.onOpenChange).not.toHaveBeenCalled();
  expect(panelSpies.groups["layout-horizontal"].defaultLayout).toBeUndefined();
});

it("should still fold the panel after a trip through the compact Sheet", () => {
  const [assistant] = panelSpies.handles;
  const { rerender } = render(<BaseLayoutShell {...props("wide")} />);
  rerender(<BaseLayoutShell {...props("compact")} />);
  rerender(
    <BaseLayoutShell {...props("compact", { assistantSheetOpen: true })} />
  );
  rerender(<BaseLayoutShell {...props("wide")} />);
  assistant.collapse.mockClear();
  assistant.resize.mockClear();
  // The next real toggle on wide is a toggle, not a viewport switch
  rerender(<BaseLayoutShell {...props("wide", { assistantOpen: false })} />);
  expect(assistant.collapse).toHaveBeenCalledTimes(1);
});

it("should still open a folded panel after a trip through the compact Sheet", () => {
  const [assistant] = panelSpies.handles;
  assistant.isCollapsed.mockReturnValue(true);
  const { rerender } = render(
    <BaseLayoutShell {...props("wide", { assistantOpen: false })} />
  );
  rerender(<BaseLayoutShell {...props("compact")} />);
  rerender(
    <BaseLayoutShell {...props("compact", { assistantSheetOpen: true })} />
  );
  rerender(<BaseLayoutShell {...props("compact")} />);
  rerender(<BaseLayoutShell {...props("wide", { assistantOpen: false })} />);
  assistant.resize.mockClear();
  rerender(<BaseLayoutShell {...props("wide", { assistantOpen: true })} />);
  expect(assistant.resize).toHaveBeenCalledWith(PANEL_SIZES.assistant.default);
});

it("should open an assistant panel that mounts folded with assistantOpen true, at its default width", () => {
  // `expand()` would open a panel that mounted folded at its minimum
  const [assistant] = panelSpies.handles;
  assistant.isCollapsed.mockReturnValue(true);
  render(<BaseLayoutShell {...props("wide")} />);
  expect(assistant.resize).toHaveBeenCalledTimes(1);
  expect(assistant.resize).toHaveBeenCalledWith(PANEL_SIZES.assistant.default);
  expect(assistant.collapse).not.toHaveBeenCalled();
});

it("should open a console that mounts folded with consoleOpen true, at its default height", () => {
  const consolePanel = panelSpies.handles[1];
  consolePanel.isCollapsed.mockReturnValue(true);
  render(<BaseLayoutShell {...props("wide", { consoleOpen: true })} />);
  expect(consolePanel.resize).toHaveBeenCalledWith(PANEL_SIZES.console.default);
});

it("should do nothing when the console panel already matches consoleOpen", () => {
  const consolePanel = panelSpies.handles[1];
  consolePanel.isCollapsed.mockReturnValue(true);
  render(<BaseLayoutShell {...props("wide")} />);
  expect(consolePanel.collapse).not.toHaveBeenCalled();
  expect(consolePanel.resize).not.toHaveBeenCalled();
});

it("should not take or save a horizontal layout below 1024 px", () => {
  const compact = props("compact", {
    horizontal: { center: 70, assistant: 30 },
  });
  render(<BaseLayoutShell {...compact} />);
  const group = panelSpies.groups["layout-horizontal"];
  expect(group.defaultLayout).toBeUndefined();
  expect(group.onLayoutChanged).toBeUndefined();
});

it("should take and save the horizontal layout on a wide screen", () => {
  const wide = props("wide", { horizontal: { center: 70, assistant: 30 } });
  render(<BaseLayoutShell {...wide} />);
  const group = panelSpies.groups["layout-horizontal"];
  expect(group.defaultLayout).toEqual({ center: 70, assistant: 30 });
  group.onLayoutChanged!(
    { center: 60, assistant: 40 },
    { isUserInteraction: true }
  );
  expect(wide.onHorizontalLayout).toHaveBeenCalledWith({
    center: 60,
    assistant: 40,
  });
});

it("should not save a layout the library settled on its own", () => {
  // On mount and on a window resize the group reports its clamped layout;
  // saving that would pin the sizes of a window the user has since left
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  panelSpies.groups["layout-horizontal"].onLayoutChanged!(
    { center: 60, assistant: 40 },
    { isUserInteraction: false }
  );
  panelSpies.groups["layout-vertical"].onLayoutChanged!(
    { stage: 60, console: 40 },
    { isUserInteraction: false }
  );
  expect(wide.onHorizontalLayout).not.toHaveBeenCalled();
  expect(wide.onVerticalLayout).not.toHaveBeenCalled();
});

it("should save a vertical layout the user dragged", () => {
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  panelSpies.groups["layout-vertical"].onLayoutChanged!(
    { stage: 60, console: 40 },
    { isUserInteraction: true }
  );
  expect(wide.onVerticalLayout).toHaveBeenCalledWith({
    stage: 60,
    console: 40,
  });
});

it("should close the project panel Sheet when it is asked to", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  const innerWidth = window.innerWidth;
  window.innerWidth = 500;
  try {
    let close = () => false;
    const dispose = vi.fn();
    const shell = props("phone");
    render(
      <BaseLayoutShell
        {...shell}
        closeLeftSheetOn={(fn) => {
          close = fn;
          return { dispose };
        }}
      />
    );
    const sheet = () =>
      document.querySelector('[data-slot="sidebar"][data-mobile="true"]');
    // Nothing to close yet
    expect(close()).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand project panel" })
    );
    expect(sheet()).not.toBeNull();
    let closed = false;
    act(() => {
      closed = close();
    });
    expect(closed).toBe(true);
    expect(sheet()).toBeNull();
    expect(shell.onLeftSheetChange).toHaveBeenLastCalledWith(false);
  } finally {
    window.innerWidth = innerWidth;
  }
});

it("should not throw or report when a panel cannot yet say whether it is folded", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  panelSpies.handles.forEach((handle) =>
    handle.isCollapsed.mockImplementation(() => {
      throw new Error("Panel constraints not found for Panel console");
    })
  );
  const { rerender } = render(<BaseLayoutShell {...props("wide")} />);
  expect(() =>
    rerender(<BaseLayoutShell {...props("wide", { consoleOpen: true })} />)
  ).not.toThrow();
  panelSpies.handles.forEach((handle) => {
    expect(handle.resize).not.toHaveBeenCalled();
    expect(handle.collapse).not.toHaveBeenCalled();
  });
  expect(logs.entries.filter((entry) => entry.report)).toHaveLength(0);
});

/** The two groups' `onLayoutChanged`, as the library calls them */
const settled = (
  id: "layout-horizontal" | "layout-vertical",
  layout: Record<string, number>,
  isUserInteraction: boolean
) =>
  act(() =>
    panelSpies.groups[id].onLayoutChanged!(layout, { isUserInteraction })
  );

it("should report a drag that folds the assistant, and save its layout", () => {
  const [assistant] = panelSpies.handles;
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  assistant.isCollapsed.mockReturnValue(true);
  settled("layout-horizontal", { center: 98, assistant: 2 }, true);
  expect(wide.assistantState.onOpenChange).toHaveBeenCalledWith(false);
  expect(wide.onHorizontalLayout).toHaveBeenCalledTimes(1);
});

it("should report a drag that unfolds the console", () => {
  const consolePanel = panelSpies.handles[1];
  consolePanel.isCollapsed.mockReturnValue(true);
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  consolePanel.isCollapsed.mockReturnValue(false);
  settled("layout-vertical", { stage: 70, console: 30 }, true);
  expect(wide.consoleState.onOpenChange).toHaveBeenCalledWith(true);
});

it("should put back, not report, an open panel the library folded on its own", () => {
  // A restored size below the library's fold point mounts the panel folded
  const [assistant] = panelSpies.handles;
  const wide = props("wide", { horizontal: { center: 88, assistant: 12 } });
  render(<BaseLayoutShell {...wide} />);
  assistant.isCollapsed.mockReturnValue(true);
  settled("layout-horizontal", { center: 98, assistant: 2 }, false);
  expect(wide.assistantState.onOpenChange).not.toHaveBeenCalled();
  expect(wide.onHorizontalLayout).not.toHaveBeenCalled();
  expect(assistant.resize).toHaveBeenCalledWith(PANEL_SIZES.assistant.default);
  // Only the first layout it settles: a later one is a window resize
  assistant.resize.mockClear();
  settled("layout-horizontal", { center: 98, assistant: 2 }, false);
  expect(assistant.resize).not.toHaveBeenCalled();
});

it("should report an error from isCollapsed other than the expected one, once", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  const consolePanel = panelSpies.handles[1];
  consolePanel.isCollapsed.mockImplementation(() => {
    throw new TypeError("broken");
  });
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  settled("layout-vertical", { stage: 70, console: 30 }, true);
  settled("layout-vertical", { stage: 60, console: 40 }, true);
  const errors = logs.entries.filter((entry) => entry.level === "error");
  expect(errors).toHaveLength(1);
  expect(errors[0].report).toBe(true);
  expect(errors[0].error?.message).toBe("broken");
});
