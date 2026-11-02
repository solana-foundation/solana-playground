import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import type { DefaultTheme } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import type { ReactNode } from "react";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
// The `@/utils` barrel reaches generated globals (`GLOBAL_SETTINGS`) that
// exist only in a booted app, so the test builds it from the pieces the shell
// uses: the real keybinds, editor events and view (so a modal opens through
// `PgView.setModal`, the event the shell listens to) and a deploy command it
// can start.
const deploy = vi.hoisted(() => ({
  starts: new Set<(input: string | null) => void>(),
}));
// The open file and project the phone's bar and picker name, and the listeners
// the Files sheet closes on
const explorer = vi.hoisted(() => ({
  opens: new Set<() => void>(),
  renames: new Set<() => void>(),
  name: undefined as string | undefined,
  path: null as string | null,
}));
vi.mock("@/utils", async () => {
  const { PgKeybind } = await import("@/utils/keybind");
  const { PgCommon } = await import("@/utils/common");
  const { PgView } = await import("@/utils/view");
  return {
    PgKeybind,
    PgCommon,
    PgView,
    PgExplorer: {
      onNeedRender: () => ({ dispose: () => {} }),
      onDidOpenFile: (cb: () => void) => {
        explorer.opens.add(cb);
        return { dispose: () => explorer.opens.delete(cb) };
      },
      onDidRenameWorkspace: (cb: () => void) => {
        explorer.renames.add(cb);
        return { dispose: () => explorer.renames.delete(cb) };
      },
      get currentWorkspaceName() {
        return explorer.name;
      },
      getCurrentFile: () => (explorer.path ? { path: explorer.path } : null),
      getRelativePath: (path: string) => path.replace("/proj/", ""),
    },
    PgCommand: {
      deploy: {
        onDidStart: (cb: (input: string | null) => void) => {
          deploy.starts.add(cb);
          return { dispose: () => deploy.starts.delete(cb) };
        },
      },
    },
  };
});

// The library's own panels, with each panel ref the shell creates kept in
// order (assistant, files, console), so a test can watch the imperative calls
// on the real handle. Named one by one, as `BaseLayoutShell.test.tsx` does.
const panelRefs = vi.hoisted(
  () => [] as Array<{ current: { resize(size: number): void } | null }>
);
vi.mock("react-resizable-panels", async (importOriginal) => {
  const real = await importOriginal<typeof import("react-resizable-panels")>();
  return {
    Group: real.Group,
    Panel: real.Panel,
    Separator: real.Separator,
    usePanelRef: () => {
      const ref = real.usePanelRef();
      if (!panelRefs.includes(ref)) panelRefs.push(ref);
      return ref;
    },
  };
});

import { PgView } from "@/utils/view";
import { PgFlow } from "@/views/flow/state/stage";
import { PgAssistant } from "@/views/sidebar/assistant/store";
import { LAYOUT_STORAGE_KEY } from "../model/layout-state";
import { SWIPE_SETTLE_MS } from "./BasePhonePager";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { LAYOUT_BREAKPOINTS } from "@/shared/lib/hooks/use-viewport";
import LayoutShell from "./LayoutShell";
import type { LayoutShellProps } from "./LayoutShell";

const listeners = new Set<() => void>();
let width = 1440;
/** Answers `max-width` and `width <` queries against `width` */
const screenMedia = (query: string) => {
  const max = /max-width:\s*(\d+)px/.exec(query)?.[1];
  const below = /width\s*<\s*(\d+)px/.exec(query)?.[1];
  return {
    get matches() {
      if (below !== undefined) return width < Number(below);
      return width <= Number(max);
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
};
const resizeTo = (next: number) => {
  width = next;
  window.innerWidth = next;
  listeners.forEach((fn) => fn());
};
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  panelRefs.length = 0;
  width = 1440;
  window.innerWidth = 1440;
  explorer.name = undefined;
  explorer.path = null;
  vi.stubGlobal("matchMedia", screenMedia);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  localStorage.clear();
  PgFlow["_dispatch"]({ type: "workspace-change" });
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  // `PgView`'s stack outlives every test: a dialog left open here would be
  // closed, and reported, by its no-host wait during a later test
  for (const { id } of PgView.getOpenModals()) PgView.closeModal(null, id);
  // The shell is still mounted here: RTL's own cleanup runs after this hook
  act(() => PgFlow["_dispatch"]({ type: "workspace-change" }));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetTelemetry();
  resetLogger();
});

const toggled = () =>
  sent.events
    .filter((event) => event.name === "layout_panel_toggled")
    .map((event) => event.params);

const consoleButton = () => screen.getByRole("button", { name: "Console" });

// `PgKeybind` listens on `document` and reads Ctrl or Meta as "Ctrl"; the
// stock Sidebar listens on `window`, which an event on `document` reaches.
const press = (init: KeyboardEventInit) => fireEvent.keyDown(document, init);

/** A click as a browser sends it, pointer first */
const tap = (element: Element) => {
  fireEvent.pointerDown(element);
  fireEvent.click(element);
};

const sheetOverlay = () =>
  document.querySelector('[data-slot="sheet-overlay"]')!;

// Only what the shell reads: the font a portaled Sheet is set in
const theme = {
  font: {
    code: { family: "monospace", size: { medium: "13px" } },
    other: { family: "sans-serif" },
  },
} as unknown as DefaultTheme;

/** The shell's tree, for `render` and for a `rerender` that adds or drops Home */
const shellTree = (
  home?: LayoutShellProps["home"],
  work: { keepWork?: boolean; stage?: ReactNode } = {},
  cover?: LayoutShellProps["cover"]
) => (
  <ThemeProvider theme={theme}>
    <TooltipProvider>
      <LayoutShell
        nav={({ collapsed, toggle, closeSheet, phone }) => (
          <>
            <span data-testid="nav-shape">
              {phone ? "menu page" : "column"}
            </span>
            <button type="button" onClick={toggle}>
              {collapsed ? "Expand navigation" : "Collapse navigation"}
            </button>
            {/* Stands for the cluster row, which opens settings */}
            <button type="button" onClick={closeSheet}>
              Open settings
            </button>
          </>
        )}
        stageTabs={<div>stage tabs</div>}
        files={({ collapsed, toggle, phone }) => (
          // Stands for a control inside the column; the stage bar carries
          // "Collapse project panel" / "Expand project panel"
          <button
            type="button"
            aria-expanded={!collapsed}
            data-phone={phone}
            onClick={toggle}
          >
            Files column control
          </button>
        )}
        stage={() => work.stage ?? <main>stage</main>}
        console={({ open, toggle }) => (
          <button
            type="button"
            aria-label="Console"
            aria-expanded={open}
            onClick={toggle}
          />
        )}
        assistant={({ open, toggle, wide, setWide }) => (
          <>
            {/* The head's Hide; folded, the assistant shows nothing, and the
              stage bar carries "Expand assistant", for the panel and the Sheet alike */}
            {open && (
              <button type="button" onClick={toggle}>
                Collapse assistant
              </button>
            )}
            <span>assistant body</span>
            <button type="button" onClick={() => setWide(!wide)}>
              {wide ? "Narrow the assistant" : "Widen the assistant"}
            </button>
          </>
        )}
        home={home}
        keepWork={work.keepWork}
        cover={cover}
      />
    </TooltipProvider>
  </ThemeProvider>
);

const shell = (
  home?: LayoutShellProps["home"],
  work: { keepWork?: boolean; stage?: ReactNode } = {},
  cover?: LayoutShellProps["cover"]
) => render(shellTree(home, work, cover));

it("should report the width class once per load", () => {
  shell();
  expect(
    sent.events.filter((event) => event.name === "layout_viewport")
  ).toEqual([expect.objectContaining({ params: { viewport: "wide" } })]);
});

it("should toggle the console by button and by Ctrl+J, and say which", () => {
  shell();
  fireEvent.click(consoleButton());
  expect(consoleButton().getAttribute("aria-expanded")).toBe("true");
  press({ key: "j", ctrlKey: true });
  expect(consoleButton().getAttribute("aria-expanded")).toBe("false");
  expect(toggled()).toEqual([
    { panel: "console", open: true, via: "button" },
    { panel: "console", open: false, via: "key" },
  ]);
});

it("should report Cmd+B once, via key", () => {
  shell();
  press({ key: "b", metaKey: true });
  expect(
    screen.getByRole("button", { name: "Expand navigation" })
  ).toBeTruthy();
  expect(toggled()).toEqual([{ panel: "nav", open: false, via: "key" }]);
});

it("should report the navigation's own button as a button", () => {
  shell();
  fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
  expect(toggled()).toEqual([{ panel: "nav", open: false, via: "button" }]);
});

it("should tell the files column it is not in the phone's Sheet", () => {
  shell();
  expect(
    screen.getByRole("button", { name: "Files column control" }).dataset.phone
  ).toBe("false");
});

it("should toggle the files column by Cmd+E and by its button, and say which", () => {
  shell();
  press({ key: "e", metaKey: true });
  expect(
    screen.getByRole("button", { name: "Expand project panel" })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Expand project panel" }));
  expect(
    screen.getByRole("button", { name: "Collapse project panel" })
  ).toBeTruthy();
  expect(toggled()).toEqual([
    { panel: "files", open: false, via: "key" },
    { panel: "files", open: true, via: "button" },
  ]);
});

it("should start the navigation as a rail between 768 and 1023 px, and save nothing", () => {
  resizeTo(800);
  shell();
  expect(
    screen.getByRole("button", { name: "Expand navigation" })
  ).toBeTruthy();
  press({ key: "b", metaKey: true });
  expect(
    screen.getByRole("button", { name: "Collapse navigation" })
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
  expect(toggled()).toEqual([
    { panel: "nav", open: true, via: "key" },
    { panel: "nav", open: false, via: "button" },
  ]);
  expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
});

it("should fold the files column by Cmd+E between 768 and 1023 px, and save it", () => {
  resizeTo(800);
  shell();
  press({ key: "e", metaKey: true });
  expect(toggled()).toEqual([{ panel: "files", open: false, via: "key" }]);
  expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!).open.files).toBe(
    false
  );
});

it("should go back to the saved navigation on a wide screen", () => {
  resizeTo(800);
  shell();
  act(() => resizeTo(1440));
  expect(
    screen.getByRole("button", { name: "Collapse navigation" })
  ).toBeTruthy();
  expect(toggled()).toEqual([]);
});

it("should toggle the assistant by Ctrl+R", () => {
  shell();
  press({ key: "r", ctrlKey: true });
  expect(screen.getByRole("button", { name: "Expand assistant" })).toBeTruthy();
  expect(toggled()).toEqual([{ panel: "assistant", open: false, via: "key" }]);
});

it("should keep toggling from the current value on repeated keys", () => {
  shell();
  press({ key: "j", ctrlKey: true });
  press({ key: "j", ctrlKey: true });
  press({ key: "j", ctrlKey: true });
  expect(consoleButton().getAttribute("aria-expanded")).toBe("true");
  expect(toggled()).toHaveLength(3);
});

it("should open the assistant on a build error's Explain, as auto", () => {
  shell();
  press({ key: "r", ctrlKey: true });
  act(() => PgAssistant.requestPrompt("fix this"));
  expect(
    screen.getByRole("button", { name: "Collapse assistant" })
  ).toBeTruthy();
  expect(toggled().at(-1)).toEqual({
    panel: "assistant",
    open: true,
    via: "auto",
  });
});

it("should send each toggle once under StrictMode", async () => {
  const { StrictMode } = await import("react");
  render(
    <StrictMode>
      <ThemeProvider theme={theme}>
        <TooltipProvider>
          <LayoutShell
            nav={() => null}
            stageTabs={null}
            files={() => null}
            stage={() => <main>stage</main>}
            console={({ open, toggle }) => (
              <button type="button" aria-label="Console" onClick={toggle}>
                {String(open)}
              </button>
            )}
            assistant={() => null}
          />
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>
  );
  fireEvent.click(consoleButton());
  expect(toggled()).toEqual([{ panel: "console", open: true, via: "button" }]);
});

it("should leave a layout saved by a newer version alone, toggles included", () => {
  const newer = JSON.stringify({ v: 3, open: { nav: true } });
  localStorage.setItem(LAYOUT_STORAGE_KEY, newer);
  shell();
  expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(newer);
  fireEvent.click(consoleButton());
  expect(consoleButton().getAttribute("aria-expanded")).toBe("true");
  expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(newer);
});

it("should say once why a newer layout is not overwritten", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ v: 3 }));
  shell();
  fireEvent.click(consoleButton());
  fireEvent.click(consoleButton());
  fireEvent.click(consoleButton());
  const notes = logs.entries.filter((entry) =>
    entry.message?.includes("newer version")
  );
  expect(notes).toHaveLength(1);
});

const DRAGGED = {
  v: 2,
  open: { nav: true, files: true, assistant: true, console: true },
  h: { assistant: 40, work: 60 },
  w: { files: 25, center: 75 },
  vert: { stage: 70, console: 30 },
};

it("should drop the dragged assistant sizes when the assistant is folded", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  shell();
  press({ key: "r", ctrlKey: true });
  const folded = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(folded.open.assistant).toBe(false);
  expect(folded.h).toBeUndefined();
  // The other groups' drags stay
  expect(folded.w).toEqual({ files: 25, center: 75 });
  expect(folded.vert).toEqual({ stage: 70, console: 30 });
});

it("should widen the assistant panel to its maximum, and save nothing", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  shell();
  const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
  const assistantPanel = panelRefs[0].current!;
  const resize = vi.spyOn(assistantPanel, "resize");
  fireEvent.click(screen.getByRole("button", { name: "Widen the assistant" }));
  expect(resize).toHaveBeenCalledWith(560);
  expect(
    screen.getByRole("button", { name: "Narrow the assistant" })
  ).toBeTruthy();
  expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(saved);
  expect(toggled()).toEqual([]);
});

it("should not widen the assistant Sheet below 1024 px", () => {
  resizeTo(800);
  shell();
  fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
  fireEvent.click(screen.getByRole("button", { name: "Widen the assistant" }));
  expect(
    screen.getByRole("button", { name: "Widen the assistant" })
  ).toBeTruthy();
});

it("should drop the dragged console sizes when the console is folded", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  shell();
  press({ key: "j", ctrlKey: true });
  const folded = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(folded.open.console).toBe(false);
  expect(folded.vert).toBeUndefined();
  expect(folded.h).toEqual({ assistant: 40, work: 60 });
});

it("should drop the dragged work sizes when the files column is folded by Cmd+E", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  shell();
  press({ key: "e", metaKey: true });
  const folded = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(folded.open.files).toBe(false);
  expect(folded.w).toBeUndefined();
  expect(folded.h).toEqual({ assistant: 40, work: 60 });
  expect(folded.vert).toEqual({ stage: 70, console: 30 });
});

it("should report a corrupt saved layout to error tracking", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  localStorage.setItem(LAYOUT_STORAGE_KEY, "{");
  shell();
  const errors = logs.entries.filter((entry) => entry.level === "error");
  expect(errors).toHaveLength(1);
  expect(errors[0].report).toBe(true);
  expect(errors[0].context).toMatchObject({ reason: "corrupt" });
});

it("should keep the saved open flags when a size map does not read, and report it", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      open: { left: true, assistant: true, console: true },
      vert: { stage: 70, terminal: 30 },
    })
  );
  shell();
  expect(consoleButton().getAttribute("aria-expanded")).toBe("true");
  const dropped = logs.entries.filter((entry) =>
    entry.message?.includes("dropped")
  );
  expect(dropped).toHaveLength(1);
  expect(dropped[0].report).toBe(true);
  expect(dropped[0].context).toEqual({ dropped: ["vert"] });
});

it("should report unreachable storage once, from the read, not again from a save", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  const blocked = new DOMException("blocked", "SecurityError");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw blocked;
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw blocked;
  });
  shell();
  fireEvent.click(consoleButton());
  const reported = logs.entries.filter((entry) => entry.report);
  expect(reported).toHaveLength(1);
  expect(reported[0].error?.cause).toBe(blocked);
});

it("should keep the dragged sizes when the navigation is folded", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  shell();
  press({ key: "b", ctrlKey: true });
  expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!)).toMatchObject({
    open: { nav: false },
    h: { assistant: 40, work: 60 },
    w: { files: 25, center: 75 },
    vert: { stage: 70, console: 30 },
  });
});

it("should say once that the layout could not be saved, not on every toggle", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  shell();
  fireEvent.click(consoleButton());
  fireEvent.click(consoleButton());
  fireEvent.click(consoleButton());
  const failures = logs.entries.filter((entry) =>
    entry.error?.message.includes("could not be saved")
  );
  expect(failures).toHaveLength(1);
  expect(failures[0].report).toBe(true);
  expect((failures[0].error?.cause as Error).name).toBe("QuotaExceededError");
});

it("should report the assistant Sheet opening and closing, and save nothing", () => {
  resizeTo(800);
  shell();
  fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
  fireEvent.keyDown(document.querySelector('[data-slot="sheet-content"]')!, {
    key: "Escape",
  });
  expect(toggled()).toEqual([
    { panel: "assistant", open: true, via: "button" },
    { panel: "assistant", open: false, via: "key" },
  ]);
  expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
});

it("should report a tap on the assistant Sheet's overlay as a button", async () => {
  resizeTo(800);
  shell();
  fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
  // Radix starts listening for an outside tap a tick after the Sheet opens
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  tap(sheetOverlay());
  expect(toggled().at(-1)).toEqual({
    panel: "assistant",
    open: false,
    via: "button",
  });
});

it("should open the assistant Sheet on a build error's Explain after the window narrows", () => {
  shell();
  act(() => resizeTo(800));
  act(() => PgAssistant.requestPrompt("fix this"));
  expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
  expect(toggled()).toEqual([{ panel: "assistant", open: true, via: "auto" }]);
  expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
});

it("should open the assistant Sheet on Ctrl+R after the window narrows", () => {
  shell();
  act(() => resizeTo(800));
  press({ key: "r", ctrlKey: true });
  expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
  expect(toggled()).toEqual([{ panel: "assistant", open: true, via: "key" }]);
});

it("should set the assistant Sheet in the theme's text font, not its code font, and draw no stock close button over its header", () => {
  resizeTo(800);
  shell();
  fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
  const sheet = document.querySelector<HTMLElement>(
    '[data-slot="sheet-content"]'
  )!;
  // The code face leaked into every button of a Sheet, which inherit it
  expect(sheet.style.fontFamily).toBe("sans-serif");
  expect(sheet.querySelector('[data-slot="sheet-close"]')).toBeNull();
});

it("should save the open state and read it back", () => {
  const first = shell();
  fireEvent.click(consoleButton());
  press({ key: "b", metaKey: true });
  press({ key: "e", metaKey: true });
  press({ key: "r", ctrlKey: true });
  first.unmount();
  expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!)).toEqual({
    v: 2,
    open: { nav: false, files: false, assistant: false, console: true },
  });

  shell();
  expect(consoleButton().getAttribute("aria-expanded")).toBe("true");
  expect(
    screen.getByRole("button", { name: "Expand navigation" })
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Expand project panel" })
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Expand assistant" })).toBeTruthy();
});

it("should fall back on a corrupt saved layout and report it", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, "{");
  shell();
  expect(
    screen.getByRole("button", { name: "Collapse project panel" })
  ).toBeTruthy();
  expect(
    sent.events.filter((event) => event.name === "layout_restore_failed")
  ).toEqual([expect.objectContaining({ params: { reason: "corrupt" } })]);
});

it("should close the Sheet when crossing to wide and keep the saved state", () => {
  resizeTo(800);
  shell();
  fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
  expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull();

  act(() => resizeTo(1440));
  expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  expect(
    screen.getByRole("button", { name: "Collapse assistant" })
  ).toBeTruthy();
  // Crossing a breakpoint writes nothing
  expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
});

it("should open the console when a deploy starts, as auto", () => {
  shell();
  act(() => deploy.starts.forEach((cb) => cb(null)));
  expect(consoleButton().getAttribute("aria-expanded")).toBe("true");
  expect(toggled()).toEqual([{ panel: "console", open: true, via: "auto" }]);
});

it("should open the console once when a deploy fails, not for one already failed", () => {
  // The reducer is the only way to set a deploy's status without a deploy
  const dispatch = (ev: Parameters<typeof PgFlow.reduce>[1]) =>
    PgFlow["_dispatch"](ev);
  dispatch({ type: "deploy-start" });
  dispatch({ type: "deploy-finish", ok: false });
  shell();
  expect(toggled()).toEqual([]);

  act(() => dispatch({ type: "workspace-change" }));
  act(() => dispatch({ type: "deploy-start" }));
  act(() => dispatch({ type: "deploy-finish", ok: false }));
  expect(toggled()).toEqual([{ panel: "console", open: true, via: "auto" }]);
});

it("should not reopen the console for a change that leaves a deploy failed", () => {
  const dispatch = (ev: Parameters<typeof PgFlow.reduce>[1]) =>
    PgFlow["_dispatch"](ev);
  shell();
  act(() => dispatch({ type: "deploy-start" }));
  act(() => dispatch({ type: "deploy-finish", ok: false }));
  press({ key: "j", ctrlKey: true });
  expect(consoleButton().getAttribute("aria-expanded")).toBe("false");
  act(() => dispatch({ type: "set-stage", stage: "build" }));
  expect(PgFlow.state.deploy).toBe("failed");
  expect(consoleButton().getAttribute("aria-expanded")).toBe("false");
  expect(toggled()).toEqual([
    { panel: "console", open: true, via: "auto" },
    { panel: "console", open: false, via: "key" },
  ]);
});

/** Opens a modal the way a dialog's caller does; nothing answers it here */
const openModal = () => {
  act(() => {
    void PgView.setModal(() => null);
  });
};

it("should leave no mark when the navigation asks to close a Sheet that is not open", () => {
  // From 768 px up the navigation is a column, so there is no Sheet to close
  shell();
  tap(screen.getByRole("button", { name: "Open settings" }));
  tap(screen.getByRole("button", { name: "Collapse navigation" }));
  expect(toggled()).toEqual([{ panel: "nav", open: false, via: "button" }]);
});

/** A text field in the page, as the assistant's composer is, for the test's length */
const textField = () => {
  const input = document.createElement("input");
  document.body.appendChild(input);
  return input;
};

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

/**
 * The user agent `PgCommon.getOS` reads. Each test sets its own: jsdom's
 * default carries the host's `process.platform`, so it reads as a different
 * system on a Mac laptop and on CI.
 */
const onUserAgent = (userAgent: string) =>
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);

const filesOpen = () =>
  JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null")?.open?.files;

it("should leave Control+E in a text field its native meaning on a Mac, end of line, and not fold the files column", () => {
  onUserAgent(MAC);
  shell();
  const field = textField();
  const proceeded = fireEvent.keyDown(field, { key: "e", ctrlKey: true });
  // Not prevented: the field still moves its caret
  expect(proceeded).toBe(true);
  expect(toggled()).toEqual([]);
  expect(filesOpen()).toBeUndefined();
  field.remove();
});

it("should leave Control+E in a contenteditable alone too, on a Mac", () => {
  onUserAgent(MAC);
  shell();
  const editable = document.createElement("div");
  editable.setAttribute("contenteditable", "true");
  const inner = document.createElement("span");
  editable.appendChild(inner);
  document.body.appendChild(editable);
  expect(fireEvent.keyDown(inner, { key: "e", ctrlKey: true })).toBe(true);
  expect(toggled()).toEqual([]);
  editable.remove();
});

it("should fold the files column by Ctrl+E from a text field on Windows and Linux, where Ctrl has no meaning there", () => {
  onUserAgent(WINDOWS);
  shell();
  const field = textField();
  const proceeded = fireEvent.keyDown(field, { key: "e", ctrlKey: true });
  expect(proceeded).toBe(false);
  expect(toggled()).toEqual([{ panel: "files", open: false, via: "key" }]);
  field.remove();
});

it("should fold the files column when Control is held with Cmd in a text field on a Mac", () => {
  // The Meta makes it the shortcut, not the caret movement
  onUserAgent(MAC);
  shell();
  const field = textField();
  const proceeded = fireEvent.keyDown(field, {
    key: "e",
    ctrlKey: true,
    metaKey: true,
  });
  expect(proceeded).toBe(false);
  expect(toggled()).toEqual([{ panel: "files", open: false, via: "key" }]);
  field.remove();
});

describe.each([
  ["a Mac", MAC],
  ["Windows", WINDOWS],
])("on %s", (_, userAgent) => {
  it("should still fold the files column by Cmd+E from a text field, which has no native meaning there", () => {
    onUserAgent(userAgent);
    shell();
    const field = textField();
    const proceeded = fireEvent.keyDown(field, { key: "e", metaKey: true });
    expect(proceeded).toBe(false);
    expect(toggled()).toEqual([{ panel: "files", open: false, via: "key" }]);
    field.remove();
  });

  it("should fold the files column by Control+E outside a text field, and keep it from the page", () => {
    onUserAgent(userAgent);
    shell();
    const proceeded = fireEvent.keyDown(document.body, {
      key: "e",
      ctrlKey: true,
    });
    expect(proceeded).toBe(false);
    expect(toggled()).toEqual([{ panel: "files", open: false, via: "key" }]);
  });
});

// From the phone's line up there is no left Sheet (HOO-2208): the keys fold
// the files column and the rail as they do on a wider window
it.each([
  [LAYOUT_BREAKPOINTS.phone - 1, "the pager"],
  [LAYOUT_BREAKPOINTS.phone, "the frame, with the navigation as its rail"],
])("should show at %i px %s, and never the stock Sidebar's Sheet", (width) => {
  resizeTo(width);
  shell();
  const phone = width < LAYOUT_BREAKPOINTS.phone;
  expect(screen.queryByRole("button", { name: "Menu" }) !== null).toBe(phone);
  expect(
    screen.queryByRole("button", { name: "Expand navigation" }) !== null
  ).toBe(!phone);
  expect(
    document.querySelector('[data-slot="sidebar"][data-mobile="true"]')
  ).toBeNull();
});

it("should fold the files column by Cmd+E and unfold the rail by Cmd+B at the phone's line", () => {
  resizeTo(LAYOUT_BREAKPOINTS.phone);
  shell();
  press({ key: "e", metaKey: true });
  press({ key: "b", metaKey: true });
  expect(toggled()).toEqual([
    { panel: "files", open: false, via: "key" },
    { panel: "nav", open: true, via: "key" },
  ]);
  expect(filesOpen()).toBe(false);
});

it("should report the rail's unfolding once when it is asked twice in one tick", () => {
  resizeTo(800);
  shell();
  // The stock Sidebar toggles from the value it last rendered, so both ask for
  // the same change
  act(() => {
    press({ key: "b", metaKey: true });
    press({ key: "b", metaKey: true });
  });
  expect(toggled()).toEqual([{ panel: "nav", open: true, via: "key" }]);
});

describe("on a phone", () => {
  const events = (name: string) =>
    sent.events.filter((event) => event.name === name).map((e) => e.params);
  const phoneShell = () => {
    resizeTo(390);
    return shell();
  };
  const button = (name: string) => screen.getByRole("button", { name });
  const isChecked = (name: string) =>
    screen.getByRole("radio", { name }).getAttribute("aria-checked");
  const escapeSheet = () =>
    fireEvent.keyDown(document.querySelector('[data-slot="sheet-content"]')!, {
      key: "Escape",
    });
  const savedBefore = () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
    return localStorage.getItem(LAYOUT_STORAGE_KEY);
  };
  /** The outlet's box, which carries the page's sizing classes */
  const boxOf = (el: Element) => el.closest("div[class*='flex']")!;
  const consoleBox = () =>
    consoleButton().closest("[class~='h-2/5'], [class~='overflow-hidden']")!;

  it("hands the navigation the menu page, whose toggle brings the work back", () => {
    phoneShell();
    expect(screen.getByTestId("nav-shape").textContent).toBe("menu page");
    fireEvent.click(button("Menu"));
    fireEvent.click(button("Collapse navigation"));
    expect(events("layout_page_shown")).toEqual([
      { page: "menu", via: "button" },
      { page: "work", via: "button" },
    ]);
  });

  it("lands on the work page showing the code", () => {
    phoneShell();
    expect(isChecked("Code")).toBe("true");
    expect(events("layout_page_shown")).toEqual([]);
  });

  it("opens the preview on the last stage it showed, then back to write", () => {
    phoneShell();
    fireEvent.click(button("Preview the build"));
    expect(PgFlow.state.stage).toBe("build");
    expect(events("layout_page_shown")).toEqual([
      { page: "preview", via: "button" },
    ]);
    act(() => PgFlow.setStage("deploy"));
    fireEvent.click(button("Back to the code"));
    expect(PgFlow.state.stage).toBe("write");
    fireEvent.click(button("Preview the build"));
    expect(PgFlow.state.stage).toBe("deploy");
  });

  it("follows a stage set from elsewhere to its page", () => {
    phoneShell();
    act(() => PgFlow.setStage("build"));
    expect(events("layout_page_shown")).toEqual([
      { page: "preview", via: "auto" },
    ]);
  });

  it("tells a section that is not the current page apart by `inert`", () => {
    phoneShell();
    const inertOf = (name: string) =>
      screen.getByRole("region", { name }).hasAttribute("inert");
    expect([
      inertOf("Navigation"),
      inertOf("Work"),
      inertOf("Preview"),
    ]).toEqual([true, false, true]);
    fireEvent.click(button("Preview the build"));
    expect([
      inertOf("Navigation"),
      inertOf("Work"),
      inertOf("Preview"),
    ]).toEqual([true, true, false]);
  });

  it("puts the stage on the page that shows it", () => {
    phoneShell();
    const stageOf = () => screen.getByText("stage").closest("section")!;
    expect(stageOf().getAttribute("aria-label")).toBe("Work");
    act(() => PgFlow.setStage("build"));
    expect(stageOf().getAttribute("aria-label")).toBe("Preview");
  });

  it("brings the assistant to the work page, in Chat, when the product asks", () => {
    phoneShell();
    act(() => PgFlow.setStage("build"));
    act(() => PgAssistant.requestPrompt("fix this"));
    expect(events("layout_work_view")).toContainEqual({
      view: "chat",
      via: "auto",
    });
    expect(events("layout_page_shown").at(-1)).toEqual({
      page: "work",
      via: "auto",
    });
    expect(isChecked("Chat")).toBe("true");
  });

  it("switches Chat and Code by Ctrl+R", () => {
    phoneShell();
    press({ key: "r", ctrlKey: true });
    expect(events("layout_work_view")).toEqual([{ view: "chat", via: "key" }]);
    expect(isChecked("Chat")).toBe("true");
    // Already on Work: the key moves no page, so it reports none
    expect(events("layout_page_shown")).toEqual([]);
    // The assistant's Sheet is not the phone's
    expect(toggled()).toEqual([]);
  });

  it("shows the assistant in Chat and the stage in Code", () => {
    phoneShell();
    const assistantBox = () => boxOf(screen.getByText("assistant body"));
    expect(assistantBox().classList.contains("hidden")).toBe(true);
    expect(boxOf(screen.getByText("stage")).classList.contains("hidden")).toBe(
      false
    );
    fireEvent.click(screen.getByRole("radio", { name: "Chat" }));
    expect(assistantBox().classList.contains("hidden")).toBe(false);
    expect(events("layout_work_view")).toEqual([
      { view: "chat", via: "button" },
    ]);
  });

  it("opens the console on a deploy, for the visit and unsaved", () => {
    phoneShell();
    expect(consoleBox().classList.contains("h-2/5")).toBe(false);
    expect((consoleBox() as HTMLElement).style.height).toBe("28px");
    act(() => deploy.starts.forEach((cb) => cb(null)));
    expect(consoleBox().classList.contains("h-2/5")).toBe(true);
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it("opens Files from the picker and closes it when a file opens", () => {
    phoneShell();
    fireEvent.click(button("Files"));
    expect(
      document.querySelector('[data-slot="sheet-content"]')
    ).not.toBeNull();
    act(() => explorer.opens.forEach((cb) => cb()));
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("closes the Files sheet when a modal opens over it", () => {
    phoneShell();
    fireEvent.click(button("Files"));
    expect(
      document.querySelector('[data-slot="sheet-content"]')
    ).not.toBeNull();
    openModal();
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(toggled().at(-1)).toEqual({
      panel: "files",
      open: false,
      via: "auto",
    });
  });

  it("names the project and the open file", () => {
    explorer.name = "my-program";
    explorer.path = "/proj/src/lib.rs";
    phoneShell();
    expect(screen.getByText("my-program")).toBeTruthy();
    expect(button("Files, lib.rs open").textContent).toContain("src/");
  });

  it("moves to the work page when the navigation asks to close", () => {
    phoneShell();
    fireEvent.click(button("Menu"));
    fireEvent.click(button("Open settings"));
    expect(events("layout_page_shown").at(-1)).toEqual({
      page: "work",
      via: "auto",
    });
  });

  it("writes nothing to the saved layout on a visit", () => {
    const before = savedBefore();
    phoneShell();
    press({ key: "e", metaKey: true });
    press({ key: "e", metaKey: true });
    press({ key: "j", ctrlKey: true });
    press({ key: "r", ctrlKey: true });
    fireEvent.click(consoleButton());
    fireEvent.click(button("Files"));
    escapeSheet();
    fireEvent.click(button("Preview the build"));
    fireEvent.click(button("Back to the code"));
    fireEvent.click(button("Menu"));
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(before);
  });

  it("reports the console and the Files sheet, with what did it", () => {
    phoneShell();
    fireEvent.click(consoleButton());
    press({ key: "j", ctrlKey: true });
    act(() => deploy.starts.forEach((cb) => cb(null)));
    tap(button("Files"));
    press({ key: "e", metaKey: true });
    press({ key: "e", metaKey: true });
    escapeSheet();
    tap(button("Files"));
    escapeSheet();
    expect(toggled()).toEqual([
      { panel: "console", open: true, via: "button" },
      { panel: "console", open: false, via: "key" },
      { panel: "console", open: true, via: "auto" },
      { panel: "files", open: true, via: "button" },
      { panel: "files", open: false, via: "key" },
      { panel: "files", open: true, via: "key" },
      { panel: "files", open: false, via: "key" },
      { panel: "files", open: true, via: "button" },
      { panel: "files", open: false, via: "key" },
    ]);
  });

  it("reports a tap on the Files sheet's overlay as a button", async () => {
    phoneShell();
    tap(button("Files"));
    // Radix starts listening for an outside tap a tick after the Sheet opens
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    tap(sheetOverlay());
    expect(toggled().at(-1)).toEqual({
      panel: "files",
      open: false,
      via: "button",
    });
  });

  it("brings Work back with the stage on it after a wide visit that picked Write", () => {
    phoneShell();
    fireEvent.click(button("Preview the build"));
    expect(PgFlow.state.stage).toBe("build");
    act(() => resizeTo(1280));
    act(() => PgFlow.setStage("write"));
    act(() => resizeTo(390));
    const stageOf = () => screen.getByText("stage").closest("section")!;
    expect(stageOf().getAttribute("aria-label")).toBe("Work");
    expect(stageOf().getAttribute("inert")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Preview" }).getAttribute("inert")
    ).not.toBeNull();
  });

  it("folds the console to its bar and opens it to a share of the page", () => {
    phoneShell();
    expect((consoleBox() as HTMLElement).style.height).toBe("28px");
    expect(consoleBox().classList.contains("overflow-hidden")).toBe(true);
    fireEvent.click(consoleButton());
    expect(consoleBox().classList.contains("h-2/5")).toBe(true);
    expect((consoleBox() as HTMLElement).style.height).toBe("");
  });

  it("brings Work into view when Ctrl+R switches the view from the preview", () => {
    phoneShell();
    fireEvent.click(button("Preview the build"));
    press({ key: "r", ctrlKey: true });
    expect(events("layout_page_shown").at(-1)).toEqual({
      page: "work",
      via: "key",
    });
    expect(events("layout_work_view")).toEqual([{ view: "chat", via: "key" }]);
  });

  it("follows a swipe: the preview opens on the last stage, Work goes back to write", () => {
    vi.useFakeTimers();
    const widthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth"
    );
    // jsdom has no layout: each page is as wide as the phone
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 390,
    });
    try {
      phoneShell();
      act(() => PgFlow.setStage("deploy"));
      fireEvent.click(button("Back to the code"));
      expect(PgFlow.state.stage).toBe("write");
      const pager = screen.getByTestId("phone-pager");
      // A user's swipe comes with input (a wheel here, a touch on a phone);
      // a scroll without any is the pager's own move settling
      const swipeTo = (page: number) => {
        fireEvent.wheel(pager);
        pager.scrollLeft = page * 390;
        fireEvent.scroll(pager);
        act(() => {
          vi.advanceTimersByTime(SWIPE_SETTLE_MS);
        });
      };
      swipeTo(2);
      expect(events("layout_page_shown").at(-1)).toEqual({
        page: "preview",
        via: "swipe",
      });
      expect(PgFlow.state.stage).toBe("deploy");
      swipeTo(1);
      expect(events("layout_page_shown").at(-1)).toEqual({
        page: "work",
        via: "swipe",
      });
      expect(PgFlow.state.stage).toBe("write");
    } finally {
      vi.useRealTimers();
      if (widthDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientWidth",
          widthDescriptor
        );
      } else {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      }
    }
  });

  it("closes the assistant back to Code by its own toggle", () => {
    phoneShell();
    fireEvent.click(screen.getByRole("radio", { name: "Chat" }));
    fireEvent.click(button("Collapse assistant"));
    expect(isChecked("Code")).toBe("true");
    expect(events("layout_work_view")).toEqual([
      { view: "chat", via: "button" },
      { view: "code", via: "button" },
    ]);
  });

  it("closes the Files sheet by the column's own button", () => {
    phoneShell();
    tap(button("Files"));
    // The column is told it is in the Sheet, so Flow draws no Hide files there
    expect(button("Files column control").dataset.phone).toBe("true");
    fireEvent.click(button("Files column control"));
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(toggled().at(-1)).toEqual({
      panel: "files",
      open: false,
      via: "button",
    });
  });

  it("sends no page event for a stage set or a deploy on a wide window", () => {
    shell();
    act(() => PgFlow.setStage("build"));
    act(() => PgFlow.setStage("write"));
    expect(events("layout_page_shown")).toEqual([]);
  });

  it("shows a stage set wide on the preview once the window narrows", () => {
    shell();
    act(() => PgFlow.setStage("build"));
    act(() => resizeTo(390));
    const stageOf = () => screen.getByText("stage").closest("section")!;
    expect(stageOf().getAttribute("aria-label")).toBe("Preview");
    expect(stageOf().hasAttribute("inert")).toBe(false);
    expect(events("layout_page_shown")).toEqual([
      { page: "preview", via: "auto" },
    ]);
  });

  it("opens the preview on the last stage a wide window showed", () => {
    shell();
    act(() => PgFlow.setStage("deploy"));
    act(() => PgFlow.setStage("write"));
    act(() => resizeTo(390));
    fireEvent.click(button("Preview the build"));
    expect(PgFlow.state.stage).toBe("deploy");
  });
});

describe("the stage bar", () => {
  it("folds the files column from its toggle, via button", () => {
    shell();
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse project panel" })
    );
    expect(toggled()).toEqual([{ panel: "files", open: false, via: "button" }]);
    expect(
      screen.getByRole("button", { name: "Expand project panel" })
    ).toBeTruthy();
  });

  it("hides the assistant from its toggle and names the project", () => {
    explorer.name = "Counter";
    shell();
    expect(screen.queryByText("Counter")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide the assistant" }));
    expect(toggled()).toEqual([
      { panel: "assistant", open: false, via: "button" },
    ]);
    expect(screen.getByText("Counter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
    expect(screen.queryByText("Counter")).toBeNull();
  });

  it("opens the assistant Sheet from the bar between 768 and 1023 px", () => {
    resizeTo(900);
    shell();
    const bar = document.querySelector<HTMLElement>('[data-slot="stage-bar"]')!;
    fireEvent.click(
      within(bar).getByRole("button", { name: "Expand assistant" })
    );
    expect(toggled()).toEqual([
      { panel: "assistant", open: true, via: "button" },
    ]);
    expect(
      document.querySelector('[data-slot="sheet-content"]')
    ).not.toBeNull();
  });

  it("names the project again after a rename", () => {
    explorer.name = "Counter";
    shell();
    fireEvent.click(screen.getByRole("button", { name: "Hide the assistant" }));
    explorer.name = "Counter v2";
    act(() => explorer.renames.forEach((cb) => cb()));
    expect(screen.getByText("Counter v2")).toBeTruthy();
  });

  it("names the project between 768 and 1023 px while the assistant's Sheet is closed", () => {
    explorer.name = "Counter";
    resizeTo(900);
    shell();
    const bar = () =>
      document.querySelector<HTMLElement>('[data-slot="stage-bar"]')!;
    expect(within(bar()).getByText("Counter")).toBeTruthy();
    fireEvent.click(
      within(bar()).getByRole("button", { name: "Expand assistant" })
    );
    // Open, the Sheet's head names it
    expect(within(bar()).queryByText("Counter")).toBeNull();
  });

  it("leaves one Expand assistant between 768 and 1023 px", () => {
    resizeTo(900);
    shell();
    expect(
      screen.getAllByRole("button", { name: "Expand assistant" })
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Hide the assistant" })
    ).toBeNull();
  });

  it("holds the files column's one toggle at the phone's line, with no opener at the left edge", () => {
    resizeTo(LAYOUT_BREAKPOINTS.phone);
    shell();
    expect(
      screen.getAllByRole("button", { name: "Collapse project panel" })
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Expand project panel" })
    ).toBeNull();
  });

  it("is not drawn on a phone", () => {
    resizeTo(390);
    shell();
    expect(document.querySelector('[data-slot="stage-bar"]')).toBeNull();
    expect(screen.getAllByText("stage tabs").length).toBeGreaterThan(0);
  });
});

describe("layout_assistant_widened", () => {
  const widened = () =>
    sent.events
      .filter((event) => event.name === "layout_assistant_widened")
      .map((event) => event.params);

  it("is sent for Widen and for Narrow", () => {
    shell();
    fireEvent.click(
      screen.getByRole("button", { name: "Widen the assistant" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Narrow the assistant" })
    );
    expect(widened()).toEqual([{ wide: true }, { wide: false }]);
  });

  it("is not sent when hiding a widened assistant narrows it", () => {
    shell();
    fireEvent.click(
      screen.getByRole("button", { name: "Widen the assistant" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide the assistant" }));
    expect(widened()).toEqual([{ wide: true }]);
  });

  it("is not sent where there is nothing to widen", () => {
    resizeTo(900);
    shell();
    fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Widen the assistant" })
    );
    expect(widened()).toEqual([]);
  });
});

describe("with Home", () => {
  const home: LayoutShellProps["home"] = ({ openAssistant }) => (
    <button type="button" onClick={openAssistant}>
      ask
    </button>
  );
  const saved = () => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
    return localStorage.getItem(LAYOUT_STORAGE_KEY);
  };

  it("opens no console on a deploy, saving nothing", () => {
    // Folded, so a deploy would have something to open
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        v: DRAGGED.v,
        open: { nav: true, files: true, assistant: true, console: false },
        h: DRAGGED.h,
        w: DRAGGED.w,
        vert: DRAGGED.vert,
      })
    );
    const before = localStorage.getItem(LAYOUT_STORAGE_KEY);
    shell(home);
    act(() => deploy.starts.forEach((cb) => cb(null)));
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(before);
    expect(toggled()).toEqual([]);
  });

  it("keeps the stage mounted under Home when told to keep the work", () => {
    const stageMounts = vi.fn();
    const Stage = () => {
      useEffect(() => stageMounts(), []);
      return <main>stage</main>;
    };
    const tree = (withHome: boolean) =>
      shellTree(withHome ? home : undefined, {
        keepWork: true,
        stage: <Stage />,
      });
    const { rerender } = render(tree(false));
    rerender(tree(true));
    expect(screen.queryByText("stage")).toBeNull();
    rerender(tree(false));
    expect(screen.getByText("stage")).toBeTruthy();
    expect(stageMounts).toHaveBeenCalledTimes(1);
  });

  it("leaves the saved layout as it was across Home and after it", () => {
    const before = saved();
    const { rerender } = shell(home);
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(before);
    rerender(shellTree());
    expect(screen.getByText("stage")).toBeTruthy();
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(before);
    expect(toggled()).toEqual([]);
  });

  it("opens the assistant Sheet from Home and closes it, saving nothing", () => {
    const before = saved();
    shell(home);
    expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
    fireEvent.keyDown(document.querySelector('[data-slot="sheet-content"]')!, {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
    expect(toggled()).toEqual([
      { panel: "assistant", open: true, via: "button" },
      { panel: "assistant", open: false, via: "key" },
    ]);
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(before);
  });

  it.each([
    ["wide", 1440],
    ["compact", 800],
    ["phone", 390],
  ] as const)(
    "leaves the layout alone on Ctrl+J, Cmd+E and Ctrl+R (%s)",
    (_, at) => {
      const before = saved();
      resizeTo(at);
      shell(home);
      press({ key: "j", ctrlKey: true });
      press({ key: "e", metaKey: true });
      press({ key: "r", ctrlKey: true });
      expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(before);
      expect(toggled()).toEqual([]);
      expect(
        sent.events.filter((event) =>
          ["layout_page_shown", "layout_work_view"].includes(event.name)
        )
      ).toEqual([]);
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  );

  it("opens the assistant Sheet when the product asks, saving nothing", () => {
    const before = saved();
    shell(home);
    act(() => PgAssistant.requestPrompt("fix this"));
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
    expect(toggled()).toEqual([
      { panel: "assistant", open: true, via: "auto" },
    ]);
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(before);
  });

  it("titles the phone's work page Home and stays there when the stage changes", () => {
    resizeTo(390);
    shell(home);
    const work = screen.getByRole("region", { name: "Work" });
    expect(within(work).getByTestId("phone-bar").textContent).toContain("Home");
    act(() => PgFlow.setStage("build"));
    expect(
      sent.events.filter((event) => event.name === "layout_page_shown")
    ).toEqual([]);
    expect(work.hasAttribute("inert")).toBe(false);
  });

  it("opens the assistant Sheet from Home on a phone", () => {
    resizeTo(390);
    shell(home);
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
    expect(toggled()).toEqual([
      { panel: "assistant", open: true, via: "button" },
    ]);
  });

  it("keeps the conversation on screen in the work's Sheet when the work takes over (900 px)", () => {
    resizeTo(900);
    const { rerender } = shell(home);
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    rerender(shellTree());
    expect(screen.getByText("stage")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByText("assistant body")).toBeTruthy();
    expect(toggled()).toEqual([
      { panel: "assistant", open: true, via: "button" },
      { panel: "assistant", open: true, via: "auto" },
    ]);
  });

  it("opens the folded assistant column when the work takes over (1440 px)", () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        v: DRAGGED.v,
        open: { nav: true, files: true, assistant: false, console: true },
        h: DRAGGED.h,
        w: DRAGGED.w,
        vert: DRAGGED.vert,
      })
    );
    const { rerender } = shell(home);
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    rerender(shellTree());
    expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Collapse assistant" })
    ).toBeTruthy();
  });

  it.each([
    ["wide", 1440],
    ["compact", 900],
  ] as const)(
    "opens nothing when the work takes over with Home's Sheet closed (%s)",
    (_, at) => {
      resizeTo(at);
      const { rerender } = shell(home);
      rerender(shellTree());
      expect(screen.queryByRole("dialog", { name: "Assistant" })).toBeNull();
      expect(toggled()).toEqual([]);
    }
  );

  it("draws the column bar over Home, titled Home, with no files toggle", () => {
    explorer.name = "Counter";
    shell(home);
    const bar = document.querySelector<HTMLElement>('[data-slot="stage-bar"]')!;
    expect(within(bar).getByText("Home")).toBeTruthy();
    expect(within(bar).queryByText("Counter")).toBeNull();
    expect(
      within(bar).queryByRole("button", { name: /project panel/ })
    ).toBeNull();
    expect(screen.queryByText("stage tabs")).toBeNull();
  });

  it("titles the bar nothing while the start is pending", () => {
    explorer.name = "Counter";
    shell(() => null);
    const bar = document.querySelector<HTMLElement>('[data-slot="stage-bar"]')!;
    expect(within(bar).queryByText("Home")).toBeNull();
  });

  it("titles the phone's work page nothing while the start is pending", () => {
    resizeTo(390);
    shell(() => null);
    const work = screen.getByRole("region", { name: "Work" });
    expect(within(work).getByTestId("phone-bar").textContent).not.toContain(
      "Home"
    );
  });

  it.each([
    ["wide", 1440],
    ["compact", 900],
  ] as const)(
    "opens the assistant Sheet from the bar's toggle under Home (%s)",
    (_, at) => {
      const before = saved();
      resizeTo(at);
      shell(home);
      const bar = document.querySelector<HTMLElement>(
        '[data-slot="stage-bar"]'
      )!;
      fireEvent.click(
        within(bar).getByRole("button", { name: "Expand assistant" })
      );
      expect(screen.getByRole("dialog", { name: "Assistant" })).toBeTruthy();
      // The open Sheet is modal, so the bar behind it is hidden from the tree
      expect(
        within(bar).getByRole("button", {
          name: "Hide the assistant",
          hidden: true,
        })
      ).toBeTruthy();
      expect(toggled()).toEqual([
        { panel: "assistant", open: true, via: "button" },
      ]);
      expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(before);
    }
  );
});

describe("with a page over the work", () => {
  const cover = (onClose = vi.fn()): LayoutShellProps["cover"] => ({
    title: "Tutorials",
    content: <div>page slot</div>,
    onClose,
  });

  it.each([
    ["wide", 1440],
    ["compact", 800],
    ["phone", 390],
  ] as const)(
    "leaves the layout alone on Ctrl+J, Cmd+E and Ctrl+R (%s)",
    (_, at) => {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
      const before = localStorage.getItem(LAYOUT_STORAGE_KEY);
      resizeTo(at);
      shell(undefined, {}, cover());
      press({ key: "j", ctrlKey: true });
      press({ key: "e", metaKey: true });
      press({ key: "r", ctrlKey: true });
      expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(before);
      expect(toggled()).toEqual([]);
    }
  );

  it("names the page in a bar of its own, with no column toggles", () => {
    resizeTo(1440);
    shell(undefined, {}, cover());
    const over = within(screen.getByTestId("layout-cover"));
    expect(over.getByText("Tutorials")).toBeTruthy();
    expect(over.getByText("page slot")).toBeTruthy();
    expect(
      over.queryByRole("button", { name: /assistant|project panel/i })
    ).toBeNull();
  });

  it("closes the page when the product asks for the assistant", () => {
    resizeTo(1440);
    const onClose = vi.fn();
    shell(undefined, {}, cover(onClose));
    act(() => PgAssistant.requestPrompt("fix this"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("brings a phone to the work page when a page opens", () => {
    resizeTo(390);
    const { rerender } = shell();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    rerender(shellTree(undefined, {}, cover()));
    expect(
      sent.events.filter((e) => e.name === "layout_page_shown").at(-1)?.params
    ).toEqual({ page: "work", via: "auto" });
  });
});
