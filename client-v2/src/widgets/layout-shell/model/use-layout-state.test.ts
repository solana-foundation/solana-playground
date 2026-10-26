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

/** Every panel open, with all three groups dragged */
const DRAGGED = {
  v: 2,
  open: { nav: true, files: true, assistant: true, console: true },
  h: { assistant: 40, work: 60 },
  w: { files: 25, center: 75 },
  vert: { stage: 70, console: 30 },
};

/** What version 1 stored, before the files and nav panels */
const V1 = {
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
    expect(stored().h).toEqual({ assistant: 40, work: 60 });
    expect(stored().w).toEqual({ files: 25, center: 75 });
  }
);

it("should save no layout that is missing a panel, and log it", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  const { result } = renderHook(() => useLayoutState());
  act(() => result.current.setHorizontal({ work: 100 }));
  act(() => result.current.setWork({ center: 100 }));
  act(() => result.current.setVertical({ stage: 100 }));
  expect(stored()).toBeNull();
  expect(result.current.state.h).toBeUndefined();
  expect(result.current.state.w).toBeUndefined();
  expect(
    logs.entries.filter((entry) => entry.message?.includes("not saved"))
  ).toHaveLength(3);
});

it("should report the first refused drag of a mount and only warn after it", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  const { result } = renderHook(() => useLayoutState());
  act(() => result.current.setWork({ center: 100 }));
  act(() => result.current.setVertical({ stage: 100 }));
  const reported = logs.entries.filter((entry) => entry.report);
  expect(reported).toHaveLength(1);
  expect(reported[0].context).toEqual({
    group: "w",
    layout: { center: 100 },
  });
});

it("should write nothing on mount", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(DRAGGED));
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  renderHook(() => useLayoutState());
  expect(setItem).not.toHaveBeenCalled();
});

it("should save the files and center sizes", () => {
  const { result } = renderHook(() => useLayoutState());
  act(() => result.current.setWork({ files: 30, center: 70 }));
  expect(result.current.state.w).toEqual({ files: 30, center: 70 });
  expect(stored().w).toEqual({ files: 30, center: 70 });
});

it("should write a migrated layout back once on mount, as version 2", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(V1));
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  renderHook(() => useLayoutState());
  expect(setItem).toHaveBeenCalledTimes(1);
  expect(stored()).toEqual({
    v: 2,
    open: { nav: true, files: true, assistant: true, console: true },
    vert: { stage: 70, console: 30 },
  });
});

it("should write a migrated layout once under StrictMode", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(V1));
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  renderHook(() => useLayoutState(), { reactStrictMode: true });
  expect(setItem).toHaveBeenCalledTimes(1);
});

it("should report a failed write of a migrated layout once, as the migration's", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(V1));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  const { result } = renderHook(() => useLayoutState());
  // The migration's own write failed, before any toggle
  const reports = () => logs.entries.filter((entry) => entry.report);
  expect(reports()).toHaveLength(1);
  expect(reports()[0].context).toEqual({ during: "migration" });
  // A later write fails the same way and is not reported again
  act(() => result.current.setOpen("console", { open: false, via: "button" }));
  expect(reports()).toHaveLength(1);
});

it("should tag a failed save that is not the migration's as a save", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  const { result } = renderHook(() => useLayoutState());
  act(() => result.current.setOpen("console", { open: true, via: "button" }));
  const reported = logs.entries.filter((entry) => entry.report);
  expect(reported).toHaveLength(1);
  expect(reported[0].context).toEqual({ during: "save" });
});

it("should say, without reporting, that a migrated layout's horizontal sizes were dropped on purpose", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(V1));
  renderHook(() => useLayoutState());
  const said = logs.entries.filter((entry) =>
    entry.message?.includes("not carried over")
  );
  expect(said).toHaveLength(1);
  expect(said[0].level).toBe("info");
  expect(said[0].report).toBeFalsy();
  expect(logs.entries.filter((entry) => entry.report)).toHaveLength(0);
});

it("should not say a horizontal drop happened when the version 1 layout had no horizontal sizes", () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      open: { left: true, assistant: true, console: true },
    })
  );
  renderHook(() => useLayoutState());
  expect(
    logs.entries.filter((entry) => entry.message?.includes("not carried over"))
  ).toHaveLength(0);
});

it("should not write a layout from a newer version on mount", () => {
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ v: 3 }));
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  renderHook(() => useLayoutState());
  expect(setItem).not.toHaveBeenCalled();
});
