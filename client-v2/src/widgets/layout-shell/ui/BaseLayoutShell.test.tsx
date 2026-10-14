import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";

// `usePanelRef` is replaced, so the tests can see which imperative calls the
// shell makes, and `Group` and `Panel` record their props; `Separator` is the
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
  panels: {} as Record<
    string,
    { minSize?: unknown; onResize?: (size: { inPixels: number }) => void }
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
    // Records each panel's props by id, then renders the real panel
    Panel: (panelProps: {
      id?: string;
      minSize?: unknown;
      onResize?: (size: { inPixels: number }) => void;
    }) => {
      panelSpies.panels[panelProps.id ?? ""] = panelProps;
      return createElement(
        real.Panel,
        panelProps as React.ComponentProps<typeof real.Panel>
      );
    },
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
  panelSpies.panels = {};
  // In the order the shell creates its panel refs: assistant, files, console
  panelSpies.handles = [0, 1, 2].map(() => ({
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

/** The panel handles by name, in the order the shell creates them */
const handles = () => {
  const [assistant, files, consolePanel] = panelSpies.handles;
  return { assistant, files, consolePanel };
};

/** The fields a test sets itself; the rest are the defaults below */
interface PropsChoice {
  /** Below the stock Sidebar's line; the viewport's phone by default */
  isMobile?: boolean;
  closeLeftSheetOn?: BaseLayoutShellProps["closeLeftSheetOn"];
  toggleLeftSheetOn?: BaseLayoutShellProps["toggleLeftSheetOn"];
  nav?: BaseLayoutShellProps["nav"];
  files?: BaseLayoutShellProps["files"];
  navOpen?: boolean;
  assistantOpen?: boolean;
  assistantSheetOpen?: boolean;
  filesOpen?: boolean;
  consoleOpen?: boolean;
  horizontal?: BaseLayoutShellProps["horizontal"];
  work?: BaseLayoutShellProps["work"];
}

const props = (
  viewport: BaseLayoutShellProps["viewport"],
  choice: PropsChoice = {}
): BaseLayoutShellProps => ({
  viewport,
  isMobile: choice.isMobile ?? viewport === "phone",
  navOpen: choice.navOpen ?? true,
  onNavOpenChange: vi.fn(),
  // One flag that follows the viewport: the panel on wide, the Sheet below
  assistantState: {
    open:
      viewport === "wide"
        ? choice.assistantOpen ?? true
        : choice.assistantSheetOpen ?? false,
    onOpenChange: vi.fn(),
  },
  filesState: {
    open: choice.filesOpen ?? true,
    onOpenChange: vi.fn(),
  },
  consoleState: {
    open: choice.consoleOpen ?? false,
    onOpenChange: vi.fn(),
  },
  horizontal: choice.horizontal,
  work: choice.work,
  vertical: undefined,
  onHorizontalLayout: vi.fn(),
  onWorkLayout: vi.fn(),
  onVerticalLayout: vi.fn(),
  nav: choice.nav ?? (() => <nav>nav slot</nav>),
  files: choice.files ?? (() => <aside>files slot</aside>),
  onLeftSheetChange: vi.fn(),
  closeLeftSheetOn: choice.closeLeftSheetOn ?? (() => ({ dispose: () => {} })),
  toggleLeftSheetOn:
    choice.toggleLeftSheetOn ?? (() => ({ dispose: () => {} })),
  stageBar: <header>stage bar</header>,
  stage: <main>stage slot</main>,
  console: <div className="xterm">console slot</div>,
  assistant: <section>assistant slot</section>,
  assistantOpener: <button type="button">Expand assistant</button>,
});

/** A window narrower than the stock Sidebar's 768 px, for the test's length */
const narrowWindow = () => {
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
  return () => {
    window.innerWidth = innerWidth;
  };
};

it("should lay out the navigation, the assistant, then the work area on a wide screen", () => {
  render(<BaseLayoutShell {...props("wide")} />);
  const order = [
    "nav slot",
    "assistant slot",
    "stage bar",
    "files slot",
    "stage slot",
    "console slot",
  ].map((slot) => screen.getByText(slot));
  order.slice(1).forEach((element, index) => {
    expect(
      order[index].compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
  expect(
    document.querySelectorAll('[data-slot="resizable-panel-group"]')
  ).toHaveLength(3);
  expect(document.querySelector('[data-slot="sidebar"]')).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Expand assistant" })).toBeNull();
});

it("should put the files column in the navigation's Sheet below 768 px", () => {
  const restore = narrowWindow();
  try {
    render(<BaseLayoutShell {...props("phone")} />);
    // Not in the work group, and the Sheet is closed
    expect(screen.queryByText("files slot")).toBeNull();
    expect(screen.getByText("stage slot")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand project panel" })
    );
    const sheet = document.querySelector(
      '[data-slot="sidebar"][data-mobile="true"]'
    )!;
    const nav = within(sheet as HTMLElement).getByText("nav slot");
    const files = within(sheet as HTMLElement).getByText("files slot");
    expect(
      nav.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  } finally {
    restore();
  }
});

it("should hand the navigation the stock toggle and whether it is a rail", () => {
  const nav = vi.fn(() => null);
  const shell = props("wide", { navOpen: false });
  render(
    <BaseLayoutShell
      viewport={shell.viewport}
      isMobile={shell.isMobile}
      navOpen={shell.navOpen}
      onNavOpenChange={shell.onNavOpenChange}
      assistantState={shell.assistantState}
      filesState={shell.filesState}
      consoleState={shell.consoleState}
      onHorizontalLayout={shell.onHorizontalLayout}
      onWorkLayout={shell.onWorkLayout}
      onVerticalLayout={shell.onVerticalLayout}
      nav={nav}
      files={shell.files}
      onLeftSheetChange={shell.onLeftSheetChange}
      closeLeftSheetOn={shell.closeLeftSheetOn}
      toggleLeftSheetOn={shell.toggleLeftSheetOn}
      stageBar={shell.stageBar}
      stage={shell.stage}
      console={shell.console}
      assistant={shell.assistant}
      assistantOpener={shell.assistantOpener}
    />
  );
  expect(nav).toHaveBeenLastCalledWith({
    collapsed: true,
    isMobile: false,
    toggle: expect.any(Function),
  });
});

it("should hand the navigation the Sheet's toggle, never a rail, below 768 px", () => {
  const restore = narrowWindow();
  try {
    const nav = vi.fn(() => null);
    render(<BaseLayoutShell {...props("phone", { nav })} />);
    // The Sheet renders its content once it is open
    fireEvent.click(
      screen.getByRole("button", { name: "Expand project panel" })
    );
    expect(nav).toHaveBeenLastCalledWith({
      collapsed: false,
      isMobile: true,
      toggle: expect.any(Function),
    });
  } finally {
    restore();
  }
});

it("should hand the files column no toggle in the work group, and the stock one in the Sheet", () => {
  const files = vi.fn(() => null);
  const wide = render(<BaseLayoutShell {...props("wide", { files })} />);
  expect(files).toHaveBeenLastCalledWith({ isMobile: false });
  wide.unmount();
  const restore = narrowWindow();
  try {
    files.mockClear();
    render(<BaseLayoutShell {...props("phone", { files })} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Expand project panel" })
    );
    expect(files).toHaveBeenLastCalledWith({
      isMobile: true,
      toggle: expect.any(Function),
    });
  } finally {
    restore();
  }
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
  ).toHaveLength(3);
});

it("should show the assistant Sheet when it is open", () => {
  const open = props("phone");
  render(
    <BaseLayoutShell
      viewport={open.viewport}
      isMobile={open.isMobile}
      navOpen={open.navOpen}
      onNavOpenChange={open.onNavOpenChange}
      assistantState={{
        open: true,
        onOpenChange: open.assistantState.onOpenChange,
      }}
      filesState={open.filesState}
      consoleState={open.consoleState}
      onHorizontalLayout={open.onHorizontalLayout}
      onWorkLayout={open.onWorkLayout}
      onVerticalLayout={open.onVerticalLayout}
      nav={open.nav}
      files={open.files}
      onLeftSheetChange={open.onLeftSheetChange}
      closeLeftSheetOn={open.closeLeftSheetOn}
      toggleLeftSheetOn={open.toggleLeftSheetOn}
      stageBar={open.stageBar}
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

it("should mark the sidebar expanded or collapsed from navOpen", () => {
  const open = render(<BaseLayoutShell {...props("wide")} />);
  expect(
    document.querySelector('[data-slot="sidebar"]')!.getAttribute("data-state")
  ).toBe("expanded");
  open.unmount();
  render(<BaseLayoutShell {...props("wide", { navOpen: false })} />);
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
  const { assistant } = handles();
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
  const { assistant } = handles();
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
  const { assistant } = handles();
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

it.each([
  ["assistant", "assistant", "wide", {}, PANEL_SIZES.assistant.default],
  [
    "console",
    "consolePanel",
    "wide",
    { consoleOpen: true },
    PANEL_SIZES.console.default,
  ],
  ["files column", "files", "compact", {}, PANEL_SIZES.files.default],
] as const)(
  "should open the %s that mounts folded with its flag open, at its default size",
  (_, handle, viewport, choice, size) => {
    // `expand()` would open a panel that mounted folded at its minimum
    const panel = handles()[handle];
    panel.isCollapsed.mockReturnValue(true);
    render(<BaseLayoutShell {...props(viewport, choice)} />);
    expect(panel.resize).toHaveBeenCalledTimes(1);
    expect(panel.resize).toHaveBeenCalledWith(size);
    expect(panel.collapse).not.toHaveBeenCalled();
  }
);

it("should do nothing when the console panel already matches consoleOpen", () => {
  const { consolePanel } = handles();
  consolePanel.isCollapsed.mockReturnValue(true);
  render(<BaseLayoutShell {...props("wide")} />);
  expect(consolePanel.collapse).not.toHaveBeenCalled();
  expect(consolePanel.resize).not.toHaveBeenCalled();
});

it("should not take or save a horizontal layout below 1024 px", () => {
  const compact = props("compact", {
    horizontal: { assistant: 30, work: 70 },
  });
  render(<BaseLayoutShell {...compact} />);
  const group = panelSpies.groups["layout-horizontal"];
  expect(group.defaultLayout).toBeUndefined();
  expect(group.onLayoutChanged).toBeUndefined();
});

it("should take and save the horizontal layout on a wide screen", () => {
  const wide = props("wide", { horizontal: { assistant: 30, work: 70 } });
  render(<BaseLayoutShell {...wide} />);
  const group = panelSpies.groups["layout-horizontal"];
  expect(group.defaultLayout).toEqual({ assistant: 30, work: 70 });
  group.onLayoutChanged!(
    { assistant: 40, work: 60 },
    { isUserInteraction: true }
  );
  expect(wide.onHorizontalLayout).toHaveBeenCalledWith({
    assistant: 40,
    work: 60,
  });
});

it("should not save a layout the library settled on its own", () => {
  // On mount and on a window resize the group reports its clamped layout;
  // saving that would pin the sizes of a window the user has since left
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  panelSpies.groups["layout-horizontal"].onLayoutChanged!(
    { assistant: 40, work: 60 },
    { isUserInteraction: false }
  );
  panelSpies.groups["layout-work"].onLayoutChanged!(
    { files: 20, center: 80 },
    { isUserInteraction: false }
  );
  panelSpies.groups["layout-vertical"].onLayoutChanged!(
    { stage: 60, console: 40 },
    { isUserInteraction: false }
  );
  expect(wide.onHorizontalLayout).not.toHaveBeenCalled();
  expect(wide.onWorkLayout).not.toHaveBeenCalled();
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
  const restore = narrowWindow();
  try {
    let close = () => false;
    const dispose = vi.fn();
    const shell = props("phone", {
      closeLeftSheetOn: (fn) => {
        close = fn;
        return { dispose };
      },
    });
    render(<BaseLayoutShell {...shell} />);
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
    restore();
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

/** The three groups' `onLayoutChanged`, as the library calls them */
const settled = (
  id: "layout-horizontal" | "layout-work" | "layout-vertical",
  layout: Record<string, number>,
  isUserInteraction: boolean
) =>
  act(() =>
    panelSpies.groups[id].onLayoutChanged!(layout, { isUserInteraction })
  );

it("should report a drag that folds the assistant, and save its layout", () => {
  const { assistant } = handles();
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  assistant.isCollapsed.mockReturnValue(true);
  settled("layout-horizontal", { assistant: 2, work: 98 }, true);
  expect(wide.assistantState.onOpenChange).toHaveBeenCalledWith(false);
  expect(wide.onHorizontalLayout).toHaveBeenCalledTimes(1);
});

it("should report a drag that unfolds the console", () => {
  const { consolePanel } = handles();
  consolePanel.isCollapsed.mockReturnValue(true);
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  consolePanel.isCollapsed.mockReturnValue(false);
  settled("layout-vertical", { stage: 70, console: 30 }, true);
  expect(wide.consoleState.onOpenChange).toHaveBeenCalledWith(true);
});

it("should put back, not report, an open panel the library folded on its own", () => {
  // A restored size below the library's fold point mounts the panel folded
  const { assistant } = handles();
  const wide = props("wide", { horizontal: { assistant: 12, work: 88 } });
  render(<BaseLayoutShell {...wide} />);
  assistant.isCollapsed.mockReturnValue(true);
  settled("layout-horizontal", { assistant: 2, work: 98 }, false);
  expect(wide.assistantState.onOpenChange).not.toHaveBeenCalled();
  expect(wide.onHorizontalLayout).not.toHaveBeenCalled();
  expect(assistant.resize).toHaveBeenCalledWith(PANEL_SIZES.assistant.default);
  // Only the first layout it settles: a later one is a window resize
  assistant.resize.mockClear();
  settled("layout-horizontal", { assistant: 2, work: 98 }, false);
  expect(assistant.resize).not.toHaveBeenCalled();
});

it("should report an error from isCollapsed other than the expected one, once", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  const { consolePanel } = handles();
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

it("should collapse the files column when filesState turns false", () => {
  const { files } = handles();
  const { rerender } = render(<BaseLayoutShell {...props("wide")} />);
  expect(files.collapse).not.toHaveBeenCalled();
  rerender(<BaseLayoutShell {...props("wide", { filesOpen: false })} />);
  expect(files.collapse).toHaveBeenCalledTimes(1);
});

it("should take and save the work layout the user dragged", () => {
  const wide = props("wide", { work: { files: 25, center: 75 } });
  render(<BaseLayoutShell {...wide} />);
  expect(panelSpies.groups["layout-work"].defaultLayout).toEqual({
    files: 25,
    center: 75,
  });
  settled("layout-work", { files: 30, center: 70 }, true);
  expect(wide.onWorkLayout).toHaveBeenCalledWith({ files: 30, center: 70 });
});

it("should report a drag that folds the files column", () => {
  const { files } = handles();
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  files.isCollapsed.mockReturnValue(true);
  settled("layout-work", { files: 5, center: 95 }, true);
  expect(wide.filesState.onOpenChange).toHaveBeenCalledWith(false);
  expect(wide.onWorkLayout).toHaveBeenCalledTimes(1);
});

it("should neither take nor save a work layout below 768 px", () => {
  // No `matchMedia` for the narrow window: the group follows the prop
  render(
    <BaseLayoutShell {...props("phone", { work: { files: 25, center: 75 } })} />
  );
  const group = panelSpies.groups["layout-work"];
  expect(group.defaultLayout).toBeUndefined();
  expect(group.onLayoutChanged).toBeUndefined();
  expect(screen.queryByText("files slot")).toBeNull();
});

it("should mount the files column in the work group on the render that says the window is wide", () => {
  const { rerender } = render(<BaseLayoutShell {...props("phone")} />);
  expect(screen.queryByText("files slot")).toBeNull();
  rerender(<BaseLayoutShell {...props("compact")} />);
  expect(screen.getByText("files slot")).toBeTruthy();
});

it("should size the work area to hold an open files column beside the stage", () => {
  render(<BaseLayoutShell {...props("wide")} />);
  // What each panel is given is what the constants say
  expect(panelSpies.panels["center"].minSize).toBe(PANEL_SIZES.stage.min);
  expect(panelSpies.panels["files"].minSize).toBe(PANEL_SIZES.files.min);
  const workMin = panelSpies.panels["work"].minSize as number;
  expect(workMin).toBe(PANEL_SIZES.work.min);
  // And the work area never takes less than an open files column at its
  // minimum, the handle and the stage at its minimum need
  expect(workMin).toBeGreaterThanOrEqual(
    PANEL_SIZES.files.min + PANEL_SIZES.handle + PANEL_SIZES.stage.min
  );
  // A column opens at a width it can be dragged from, and folds below that
  expect(PANEL_SIZES.files.default).toBeGreaterThanOrEqual(
    PANEL_SIZES.files.min
  );
  expect(PANEL_SIZES.files.folded).toBeLessThan(PANEL_SIZES.files.min);
});

it("should give each panel its own id", () => {
  render(<BaseLayoutShell {...props("wide")} />);
  const ids = Array.from(document.querySelectorAll("[data-panel]")).map(
    (panel) => panel.id
  );
  expect(new Set(ids).size).toBe(ids.length);
});

it("should put back, not report, a files column the library folded on its own", () => {
  // A restored size below the library's fold point mounts the column folded
  const { files } = handles();
  const wide = props("wide", { work: { files: 5, center: 95 } });
  render(<BaseLayoutShell {...wide} />);
  files.isCollapsed.mockReturnValue(true);
  settled("layout-work", { files: 2, center: 98 }, false);
  expect(wide.filesState.onOpenChange).not.toHaveBeenCalled();
  expect(wide.onWorkLayout).not.toHaveBeenCalled();
  expect(files.resize).toHaveBeenCalledWith(PANEL_SIZES.files.default);
  // Only the first layout it settles: a later one is a window resize
  files.resize.mockClear();
  settled("layout-work", { files: 2, center: 98 }, false);
  expect(files.resize).not.toHaveBeenCalled();
});

it("should settle the files column on its own, whichever group settled first", () => {
  // The assistant's first settle must not use up the files column's
  const { assistant, files } = handles();
  const wide = props("wide");
  render(<BaseLayoutShell {...wide} />);
  assistant.isCollapsed.mockReturnValue(true);
  settled("layout-horizontal", { assistant: 2, work: 98 }, false);
  files.isCollapsed.mockReturnValue(true);
  settled("layout-work", { files: 2, center: 98 }, false);
  expect(files.resize).toHaveBeenCalledWith(PANEL_SIZES.files.default);
});

it("should put back the files column again after a trip through the navigation's Sheet", () => {
  // Below 768 px the column unmounts and mounts again, and settles again
  const { files } = handles();
  const { rerender } = render(<BaseLayoutShell {...props("compact")} />);
  settled("layout-work", { files: 20, center: 80 }, false);
  rerender(<BaseLayoutShell {...props("compact", { isMobile: true })} />);
  rerender(<BaseLayoutShell {...props("compact")} />);
  files.isCollapsed.mockReturnValue(true);
  files.resize.mockClear();
  settled("layout-work", { files: 2, center: 98 }, false);
  expect(files.resize).toHaveBeenCalledWith(PANEL_SIZES.files.default);
});

it("should open a reopened files column at the width it was dragged to", () => {
  const { files } = handles();
  const { rerender } = render(<BaseLayoutShell {...props("wide")} />);
  // Dragged to 300 px while open
  act(() => panelSpies.panels["files"].onResize!({ inPixels: 300 }));
  rerender(<BaseLayoutShell {...props("wide", { filesOpen: false })} />);
  expect(files.collapse).toHaveBeenCalledTimes(1);
  // Folded: the library reports the folded width, which is not remembered
  files.isCollapsed.mockReturnValue(true);
  act(() =>
    panelSpies.panels["files"].onResize!({ inPixels: PANEL_SIZES.files.folded })
  );
  rerender(<BaseLayoutShell {...props("wide", { filesOpen: true })} />);
  expect(files.resize).toHaveBeenLastCalledWith(300);
});

it("should neither resubscribe nor need a stable function when the caller passes new ones each render", () => {
  const restore = narrowWindow();
  try {
    const subscribed = vi.fn();
    const disposed = vi.fn();
    const registrar = () => {
      subscribed();
      return { dispose: disposed };
    };
    const { rerender } = render(
      <BaseLayoutShell
        {...props("phone", {
          closeLeftSheetOn: registrar,
          toggleLeftSheetOn: registrar,
        })}
      />
    );
    expect(subscribed).toHaveBeenCalledTimes(2);
    rerender(
      <BaseLayoutShell
        {...props("phone", {
          closeLeftSheetOn: () => registrar(),
          toggleLeftSheetOn: () => registrar(),
        })}
      />
    );
    expect(subscribed).toHaveBeenCalledTimes(2);
    expect(disposed).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});
