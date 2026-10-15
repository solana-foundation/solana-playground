import { expect, it } from "vitest";

import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  readLayout,
  writeLayout,
} from "./layout-state";
import type { LayoutState } from "./layout-state";

/** An in-memory `localStorage` with only the two calls the module makes */
const memoryStorage = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
};

const SAVED: LayoutState = {
  v: 1,
  open: { left: false, assistant: true, console: true },
  h: { center: 70, assistant: 30 },
  vert: { stage: 60, console: 40 },
};

it("should start from today's Flow when nothing is saved", () => {
  const restored = readLayout(() => memoryStorage());
  expect(restored).toEqual({ kind: "none" });
  expect(DEFAULT_LAYOUT).toEqual({
    v: 1,
    open: { left: true, assistant: true, console: false },
  });
  expect(Object.isFrozen(DEFAULT_LAYOUT)).toBe(true);
  expect(Object.isFrozen(DEFAULT_LAYOUT.open)).toBe(true);
});

it("should read back what it wrote, under one key", () => {
  const storage = memoryStorage();
  expect(writeLayout(() => storage, SAVED)).toEqual({ ok: true });
  expect([...storage.items.keys()]).toEqual([LAYOUT_STORAGE_KEY]);
  expect(storage.items.get(LAYOUT_STORAGE_KEY)!.length).toBeLessThan(200);
  expect(readLayout(() => storage)).toEqual({
    kind: "saved",
    state: SAVED,
    dropped: [],
  });
});

/** The open flags most cases share: left and assistant open, console closed */
const OPEN = { left: true, assistant: true, console: false };

it.each([
  ["not JSON", "{"],
  ["not an object", "[]"],
  [
    "a flag of the wrong type",
    JSON.stringify({
      v: 1,
      open: { left: "yes", assistant: true, console: false },
    }),
  ],
  [
    "a missing flag",
    JSON.stringify({ v: 1, open: { left: true, assistant: true } }),
  ],
  [
    "the flat shape of an earlier draft",
    JSON.stringify({
      v: 1,
      leftOpen: true,
      assistantOpen: true,
      consoleOpen: false,
    }),
  ],
  ["no version", JSON.stringify({})],
  ["a version as a string", JSON.stringify({ v: "1", open: OPEN })],
  ["version 0", JSON.stringify({ v: 0, open: OPEN })],
  ["a fractional version", JSON.stringify({ v: 1.5, open: OPEN })],
])("should fall back on %s, as corrupt", (_, raw) => {
  const restored = readLayout(() =>
    memoryStorage({ [LAYOUT_STORAGE_KEY]: raw })
  );
  expect(restored.kind).toBe("failed");
  expect(restored.kind === "failed" && restored.reason).toBe("corrupt");
  expect(restored.kind === "failed" && "error" in restored).toBe(true);
});

/** Open flags with every panel open, so no size map is dropped as folded */
const ALL_OPEN = { left: true, assistant: true, console: true };

it.each([
  ["a size that is not a number", { h: { center: "70", assistant: 30 } }],
  // JSON has no NaN or Infinity: `JSON.stringify` writes both as null
  ["a null size, as NaN is stored", { h: { center: null, assistant: 30 } }],
  ["a size above 100", { h: { center: 150, assistant: 30 } }],
  ["a negative size", { h: { center: -1, assistant: 30 } }],
  ["sizes 20 short of the group", { h: { center: 50, assistant: 30 } }],
  ["sizes just past the tolerance", { h: { center: 70, assistant: 31.01 } }],
  ["unknown panel ids", { h: { main: 70, side: 30 } }],
])("should drop only the size map on %s, keeping the flags", (_, sizes) => {
  const raw = JSON.stringify({
    v: 1,
    open: ALL_OPEN,
    h: sizes.h,
    vert: { stage: 60, console: 40 },
  });
  expect(
    readLayout(() => memoryStorage({ [LAYOUT_STORAGE_KEY]: raw }))
  ).toEqual({
    kind: "saved",
    state: { v: 1, open: ALL_OPEN, vert: { stage: 60, console: 40 } },
    dropped: ["h"],
  });
});

it("should drop a vertical size map that does not read, keeping the flags", () => {
  const raw = JSON.stringify({
    v: 1,
    open: ALL_OPEN,
    vert: { top: 60, bottom: 40 },
  });
  expect(
    readLayout(() => memoryStorage({ [LAYOUT_STORAGE_KEY]: raw }))
  ).toEqual({
    kind: "saved",
    state: { v: 1, open: ALL_OPEN },
    dropped: ["vert"],
  });
});

it("should not restore a folded panel's sizes", () => {
  const raw = JSON.stringify({
    v: 1,
    open: { left: true, assistant: false, console: false },
    h: { center: 70, assistant: 30 },
    vert: { stage: 60, console: 40 },
  });
  expect(
    readLayout(() => memoryStorage({ [LAYOUT_STORAGE_KEY]: raw }))
  ).toEqual({
    kind: "saved",
    state: { v: 1, open: { left: true, assistant: false, console: false } },
    dropped: [],
  });
});

it("should accept sizes the library rounded", () => {
  const raw = JSON.stringify({
    v: 1,
    open: OPEN,
    h: { center: 66.67, assistant: 33.34 },
  });
  expect(
    readLayout(() => memoryStorage({ [LAYOUT_STORAGE_KEY]: raw }))
  ).toEqual({
    kind: "saved",
    state: { v: 1, open: OPEN, h: { center: 66.67, assistant: 33.34 } },
    dropped: [],
  });
});

it("should fall back on a newer version", () => {
  const raw = JSON.stringify({
    v: 2,
    layout: "a shape this build cannot read",
  });
  const restored = readLayout(() =>
    memoryStorage({ [LAYOUT_STORAGE_KEY]: raw })
  );
  expect(restored).toEqual({ kind: "failed", reason: "version" });
});

it("should fall back when storage throws on access", () => {
  const blocked = new DOMException("blocked", "SecurityError");
  const restored = readLayout(() => {
    throw blocked;
  });
  expect(restored).toEqual({
    kind: "failed",
    reason: "storage-unavailable",
    error: blocked,
  });
});

it("should report a write that throws, not throw", () => {
  const full = new DOMException("full", "QuotaExceededError");
  const result = writeLayout(
    () => ({
      setItem: () => {
        throw full;
      },
    }),
    SAVED
  );
  expect(result).toEqual({ ok: false, error: full });
});

it("should read back only the fields of a layout, dropping others", () => {
  const raw = JSON.stringify({
    v: 1,
    open: { left: false, assistant: true, console: true },
    h: { center: 70, assistant: 30 },
    vert: { stage: 60, console: 40 },
    extra: "x",
  });
  const restored = readLayout(() =>
    memoryStorage({ [LAYOUT_STORAGE_KEY]: raw })
  );
  expect(restored).toEqual({ kind: "saved", state: SAVED, dropped: [] });
});

it("should store the layout as it is", () => {
  const storage = memoryStorage();
  writeLayout(() => storage, SAVED);
  expect(JSON.parse(storage.items.get(LAYOUT_STORAGE_KEY)!)).toEqual(SAVED);
});
