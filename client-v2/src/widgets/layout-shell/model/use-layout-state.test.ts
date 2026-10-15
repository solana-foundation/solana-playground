import { act, renderHook } from "@testing-library/react";
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
import { LAYOUT_STORAGE_KEY } from "./layout-state";
import { useLayoutState } from "./use-layout-state";

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  localStorage.clear();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetTelemetry();
  resetLogger();
});

const stored = () => {
  const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
};

const toggles = () =>
  sent.events.filter((event) => event.name === "layout_panel_toggled");

/** Every panel open, with both groups dragged */
const DRAGGED = {
  v: 1,
  open: { left: true, assistant: true, console: true },
  h: { center: 60, assistant: 40 },
  vert: { stage: 70, console: 30 },
};

it("should write and send nothing for a toggle to the value it already has", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  const { result } = renderHook(() => useLayoutState());
  act(() => result.current.setOpen("console", { open: true, via: "auto" }));
  expect(toggles()).toHaveLength(0);
  expect(stored()).toEqual(DRAGGED);
});

it("should keep both of two updates made in one tick", () => {
  const { result } = renderHook(() => useLayoutState());
  act(() => {
    result.current.setOpen("console", { open: true, via: "drag" });
    result.current.setVertical({ stage: 70, console: 30 });
  });
  expect(result.current.state.open.console).toBe(true);
  expect(result.current.state.vert).toEqual({ stage: 70, console: 30 });
  expect(stored()).toMatchObject({
    open: { console: true },
    vert: { stage: 70, console: 30 },
  });
});

it.each([
  ["before", "fold first"],
  ["after", "sizes first"],
])(
  "should keep no sizes for a panel folded by drag, the sizes reported %s the fold",
  (_, order) => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
    const { result } = renderHook(() => useLayoutState());
    const fold = () =>
      result.current.setOpen("console", { open: false, via: "drag" });
    const sizes = () => result.current.setVertical({ stage: 96, console: 4 });
    act(() => {
      if (order === "fold first") {
        fold();
        sizes();
      } else {
        sizes();
        fold();
      }
    });
    expect(stored().vert).toBeUndefined();
    expect(stored().h).toEqual({ center: 60, assistant: 40 });
  }
);

it("should save no layout that is missing a panel, and log it", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  const { result } = renderHook(() => useLayoutState());
  act(() => result.current.setHorizontal({ center: 100 }));
  act(() => result.current.setVertical({ stage: 100 }));
  expect(stored()).toBeNull();
  expect(result.current.state.h).toBeUndefined();
  expect(
    logs.entries.filter((entry) => entry.message?.includes("not saved"))
  ).toHaveLength(2);
});

it("should write nothing on mount", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  renderHook(() => useLayoutState());
  expect(setItem).not.toHaveBeenCalled();
});
