import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import type { DefaultTheme } from "styled-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
// uses: the real keybinds and editor events, a deploy command it can start
// and modals it can open.
const deploy = vi.hoisted(() => ({
  starts: new Set<(input: string | null) => void>(),
  modals: new Set<() => void>(),
}));
vi.mock("@/utils", async () => {
  const { PgKeybind } = await import("@/utils/keybind");
  const { PgEditor } = await import("@/utils/editor");
  return {
    PgKeybind,
    PgEditor,
    PgCommand: {
      deploy: {
        onDidStart: (cb: (input: string | null) => void) => {
          deploy.starts.add(cb);
          return { dispose: () => deploy.starts.delete(cb) };
        },
      },
    },
    PgView: {
      onDidOpenModal: (cb: () => void) => {
        deploy.modals.add(cb);
        return { dispose: () => deploy.modals.delete(cb) };
      },
    },
  };
});

import { PgEditor } from "@/utils/editor";
import { PgFlow } from "@/views/flow/state/stage";
import { PgAssistant } from "@/views/sidebar/assistant/store";
import { LAYOUT_STORAGE_KEY } from "../model/layout-state";
import LayoutShell from "./LayoutShell";

const listeners = new Set<() => void>();
let width = 1440;
const screenMedia = (query: string) => {
  const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1]);
  return {
    get matches() {
      return width <= max;
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
  width = 1440;
  window.innerWidth = 1440;
  vi.stubGlobal("matchMedia", screenMedia);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  localStorage.clear();
  PgFlow["_dispatch"]({ type: "workspace-change" });
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  PgFlow["_dispatch"]({ type: "workspace-change" });
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
  font: { code: { family: "monospace", size: { medium: "13px" } } },
} as unknown as DefaultTheme;

const shell = () =>
  render(
    <ThemeProvider theme={theme}>
      <LayoutShell
        left={({ collapsed, toggle }) => (
          <button type="button" onClick={toggle}>
            {collapsed ? "Expand project panel" : "Collapse project panel"}
          </button>
        )}
        stage={<main>stage</main>}
        console={({ open, toggle }) => (
          <button
            type="button"
            aria-label="Console"
            aria-expanded={open}
            onClick={toggle}
          />
        )}
        assistant={({ open, toggle }) => (
          <button type="button" onClick={toggle}>
            {open ? "Collapse assistant" : "Expand assistant"}
          </button>
        )}
      />
    </ThemeProvider>
  );

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
    screen.getByRole("button", { name: "Expand project panel" })
  ).toBeTruthy();
  expect(toggled()).toEqual([{ panel: "left", open: false, via: "key" }]);
});

it("should report the project panel's own button as a button", () => {
  shell();
  fireEvent.click(
    screen.getByRole("button", { name: "Collapse project panel" })
  );
  expect(toggled()).toEqual([{ panel: "left", open: false, via: "button" }]);
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

it("should open the assistant on 'Fix with assistant', as auto", () => {
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
        <LayoutShell
          left={() => null}
          stage={<main>stage</main>}
          console={({ open, toggle }) => (
            <button type="button" aria-label="Console" onClick={toggle}>
              {String(open)}
            </button>
          )}
          assistant={() => null}
        />
      </ThemeProvider>
    </StrictMode>
  );
  fireEvent.click(consoleButton());
  expect(toggled()).toEqual([{ panel: "console", open: true, via: "button" }]);
});

it("should leave a layout saved by a newer version alone, toggles included", () => {
  const newer = JSON.stringify({ v: 2, open: { left: true } });
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
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ v: 2 }));
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
  v: 1,
  open: { left: true, assistant: true, console: true },
  h: { center: 60, assistant: 40 },
  vert: { stage: 70, console: 30 },
};

it("should drop the dragged assistant sizes when the assistant is folded", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  shell();
  press({ key: "r", ctrlKey: true });
  const folded = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(folded.open.assistant).toBe(false);
  expect(folded.h).toBeUndefined();
  // The console's drag is a different group's, and stays
  expect(folded.vert).toEqual({ stage: 70, console: 30 });
});

it("should drop the dragged console sizes when the console is folded", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  shell();
  press({ key: "j", ctrlKey: true });
  const folded = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!);
  expect(folded.open.console).toBe(false);
  expect(folded.vert).toBeUndefined();
  expect(folded.h).toEqual({ center: 60, assistant: 40 });
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

it("should keep the dragged sizes when the project panel is folded", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  shell();
  press({ key: "b", ctrlKey: true });
  expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!)).toMatchObject({
    open: { left: false },
    h: { center: 60, assistant: 40 },
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

it("should report Cmd+B as a key after a toggle that changed nothing", () => {
  // On a phone the button opens the Sheet and the Sheet reports itself; the
  // mark the button set must not outlive that
  resizeTo(700);
  shell();
  tap(screen.getByRole("button", { name: "Expand project panel" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Collapse project panel" })
  );
  act(() => resizeTo(1440));
  const before = toggled().length;
  press({ key: "b", metaKey: true });
  expect(toggled().slice(before)).toEqual([
    { panel: "left", open: false, via: "key" },
  ]);
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

it("should open the assistant Sheet on 'Fix with assistant' after the window narrows", () => {
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

it("should set the assistant Sheet in the theme's font and draw no stock close button over its header", () => {
  resizeTo(800);
  shell();
  fireEvent.click(screen.getByRole("button", { name: "Expand assistant" }));
  const sheet = document.querySelector<HTMLElement>(
    '[data-slot="sheet-content"]'
  )!;
  expect(sheet.style.fontFamily).toBe("monospace");
  expect(sheet.querySelector('[data-slot="sheet-close"]')).toBeNull();
});

it("should set the project panel Sheet in the theme's font", () => {
  resizeTo(500);
  shell();
  tap(screen.getByRole("button", { name: "Expand project panel" }));
  const sheet = document.querySelector<HTMLElement>(
    '[data-slot="sidebar"][data-mobile="true"]'
  )!;
  expect(
    sheet.querySelector<HTMLElement>('[style*="font-family"]')?.style.fontFamily
  ).toBe("monospace");
});

it("should open the project panel Sheet below 768 px and report it", () => {
  resizeTo(500);
  shell();
  tap(screen.getByRole("button", { name: "Expand project panel" }));
  const sheet = document.querySelector(
    '[data-slot="sidebar"][data-mobile="true"]'
  );
  expect(sheet).not.toBeNull();
  expect(toggled()).toEqual([{ panel: "left", open: true, via: "button" }]);
  expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBeNull();
});

it("should report the project panel Sheet toggled by Cmd+B below 768 px as a key", () => {
  resizeTo(500);
  shell();
  press({ key: "b", metaKey: true });
  press({ key: "b", metaKey: true });
  expect(toggled()).toEqual([
    { panel: "left", open: true, via: "key" },
    { panel: "left", open: false, via: "key" },
  ]);
});

it("should report the project panel Sheet closed by Escape as a key and by its own button as a button", () => {
  resizeTo(500);
  shell();
  tap(screen.getByRole("button", { name: "Expand project panel" }));
  fireEvent.keyDown(
    document.querySelector('[data-slot="sidebar"][data-mobile="true"]')!,
    { key: "Escape" }
  );
  tap(screen.getByRole("button", { name: "Expand project panel" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Collapse project panel" })
  );
  expect(toggled()).toEqual([
    { panel: "left", open: true, via: "button" },
    { panel: "left", open: false, via: "key" },
    { panel: "left", open: true, via: "button" },
    { panel: "left", open: false, via: "button" },
  ]);
});

it("should render the project panel open in the Sheet, whatever the saved desktop state", () => {
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      open: { left: false, assistant: true, console: false },
    })
  );
  resizeTo(500);
  shell();
  tap(screen.getByRole("button", { name: "Expand project panel" }));
  const sheet = document.querySelector(
    '[data-slot="sidebar"][data-mobile="true"]'
  )!;
  expect(sheet.textContent).toContain("Collapse project panel");
  expect(sheet.textContent).not.toContain("Expand project panel");
});

it("should save the open state and read it back", () => {
  const first = shell();
  fireEvent.click(consoleButton());
  first.unmount();
  expect(JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY)!)).toMatchObject({
    open: { console: true },
  });

  shell();
  expect(consoleButton().getAttribute("aria-expanded")).toBe("true");
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

it("should report a blocked edit once per load", () => {
  shell();
  document.dispatchEvent(new CustomEvent(PgEditor.events.READ_ONLY_EDIT));
  document.dispatchEvent(new CustomEvent(PgEditor.events.READ_ONLY_EDIT));
  expect(
    sent.events.filter((event) => event.name === "layout_readonly_edit_blocked")
  ).toHaveLength(1);
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

  dispatch({ type: "workspace-change" });
  dispatch({ type: "deploy-start" });
  act(() => dispatch({ type: "deploy-finish", ok: false }));
  expect(toggled()).toEqual([{ panel: "console", open: true, via: "auto" }]);
});

it("should not reopen the console for a change that leaves a deploy failed", () => {
  const dispatch = (ev: Parameters<typeof PgFlow.reduce>[1]) =>
    PgFlow["_dispatch"](ev);
  shell();
  dispatch({ type: "deploy-start" });
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

it("should close the project panel Sheet when a modal opens", () => {
  resizeTo(500);
  shell();
  tap(screen.getByRole("button", { name: "Expand project panel" }));
  act(() => deploy.modals.forEach((open) => open()));
  expect(
    document.querySelector('[data-slot="sidebar"][data-mobile="true"]')
  ).toBeNull();
  expect(toggled().at(-1)).toEqual({ panel: "left", open: false, via: "auto" });
  // A modal with the Sheet already closed leaves no mark behind
  act(() => deploy.modals.forEach((open) => open()));
  tap(screen.getByRole("button", { name: "Expand project panel" }));
  expect(toggled().at(-1)).toEqual({
    panel: "left",
    open: true,
    via: "button",
  });
});

it("should report nothing for a modal on a desktop when the Sheet was left open on a phone", () => {
  // The stock Sidebar keeps the Sheet open across 768 px, where it shows none
  resizeTo(500);
  shell();
  tap(screen.getByRole("button", { name: "Expand project panel" }));
  act(() => resizeTo(1440));
  const before = toggled().length;
  act(() => deploy.modals.forEach((open) => open()));
  expect(toggled()).toHaveLength(before);
  // And no `auto` mark is left for the next toggle
  press({ key: "b", metaKey: true });
  expect(toggled().at(-1)).toEqual({ panel: "left", open: false, via: "key" });
});
