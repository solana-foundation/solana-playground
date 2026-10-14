import { expect, it } from "vitest";

import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION,
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
  v: 2,
  open: { nav: true, files: true, assistant: true, console: true },
  h: { assistant: 30, work: 70 },
  w: { files: 25, center: 75 },
  vert: { stage: 60, console: 40 },
};

it("should start from today's Flow when nothing is saved", () => {
  const restored = readLayout(() => memoryStorage());
  expect(restored).toEqual({ kind: "none" });
  expect(DEFAULT_LAYOUT).toEqual({
    v: 2,
    open: { nav: true, files: true, assistant: true, console: false },
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
    migrated: false,
  });
});

/** The open flags most cases share: all but the console open */
const OPEN = { nav: true, files: true, assistant: true, console: false };

it.each([
  ["not JSON", "{"],
  ["not an object", "[]"],
  [
    "a flag of the wrong type",
    JSON.stringify({
      v: 2,
      open: { nav: "yes", files: true, assistant: true, console: false },
    }),
  ],
  [
    "a v1 layout with a flag of the wrong type",
    JSON.stringify({
      v: 1,
      open: { left: "yes", assistant: true, console: false },
    }),
  ],
  [
    "a missing flag",
    JSON.stringify({
      v: 2,
      open: { nav: true, files: true, assistant: true },
    }),
  ],
  [
    "the flags of one version under the other",
    JSON.stringify({
      v: 2,
      open: { left: true, assistant: true, console: false },
    }),
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
  ["a version as a string", JSON.stringify({ v: "2", open: OPEN })],
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
const ALL_OPEN = { nav: true, files: true, assistant: true, console: true };

it.each([
  ["a size that is not a number", { assistant: "30", work: 70 }],
  // JSON has no NaN or Infinity: `JSON.stringify` writes both as null
  ["a null size, as NaN is stored", { assistant: null, work: 70 }],
  ["a size above 100", { assistant: 30, work: 150 }],
  ["a negative size", { assistant: -1, work: 70 }],
  ["sizes 20 short of the group", { assistant: 30, work: 50 }],
  ["sizes just past the tolerance", { assistant: 31.01, work: 70 }],
  ["unknown panel ids", { main: 70, side: 30 }],
])("should drop only the size map on %s, keeping the flags", (_, sizes) => {
  const raw = JSON.stringify({
    v: 2,
    open: ALL_OPEN,
    h: sizes,
    w: { files: 25, center: 75 },
    vert: { stage: 60, console: 40 },
  });
  expect(
    readLayout(() => memoryStorage({ [LAYOUT_STORAGE_KEY]: raw }))
  ).toEqual({
    kind: "saved",
    state: {
      v: 2,
      open: ALL_OPEN,
      w: { files: 25, center: 75 },
      vert: { stage: 60, console: 40 },
    },
    dropped: ["h"],
    migrated: false,
  });
});

it("should drop a work size map that does not read, keeping the flags", () => {
  const raw = JSON.stringify({
    v: 2,
    open: ALL_OPEN,
    w: { files: 25, center: 50 },
  });
  expect(
    readLayout(() => memoryStorage({ [LAYOUT_STORAGE_KEY]: raw }))
  ).toEqual({
    kind: "saved",
    state: { v: 2, open: ALL_OPEN },
    dropped: ["w"],
    migrated: false,
  });
});

it("should drop a vertical size map that does not read, keeping the flags", () => {
  const raw = JSON.stringify({
    v: 2,
    open: ALL_OPEN,
    vert: { top: 60, bottom: 40 },
  });
  expect(
    readLayout(() => memoryStorage({ [LAYOUT_STORAGE_KEY]: raw }))
  ).toEqual({
    kind: "saved",
    state: { v: 2, open: ALL_OPEN },
    dropped: ["vert"],
    migrated: false,
  });
});

it("should not restore a folded panel's sizes", () => {
  const raw = JSON.stringify({
    v: 2,
    open: { nav: true, files: false, assistant: false, console: false },
    h: { assistant: 30, work: 70 },
    w: { files: 25, center: 75 },
    vert: { stage: 60, console: 40 },
  });
  expect(
    readLayout(() => memoryStorage({ [LAYOUT_STORAGE_KEY]: raw }))
  ).toEqual({
    kind: "saved",
    state: {
      v: 2,
      open: { nav: true, files: false, assistant: false, console: false },
    },
    dropped: [],
    migrated: false,
  });
});

it("should migrate a layout saved before the four columns", () => {
  const storage = memoryStorage({
    [LAYOUT_STORAGE_KEY]: JSON.stringify({
      v: 1,
      open: { left: false, assistant: true, console: true },
      h: { center: 70, assistant: 30 },
      vert: { stage: 60, console: 40 },
    }),
  });
  expect(readLayout(() => storage)).toEqual({
    kind: "saved",
    state: {
      v: 2,
      open: { nav: true, files: false, assistant: true, console: true },
      h: undefined,
      w: undefined,
      vert: { stage: 60, console: 40 },
    },
    dropped: [],
    migrated: true,
    droppedH: true,
  });
});

it("should drop a v1 vertical size map that does not read, when migrating", () => {
  const storage = memoryStorage({
    [LAYOUT_STORAGE_KEY]: JSON.stringify({
      v: 1,
      open: { left: true, assistant: true, console: true },
      vert: { top: 60, bottom: 40 },
    }),
  });
  expect(readLayout(() => storage)).toEqual({
    kind: "saved",
    state: { v: 2, open: ALL_OPEN },
    dropped: ["vert"],
    migrated: true,
  });
});

it("should drop a v1 vertical size map of a folded console, when migrating", () => {
  const storage = memoryStorage({
    [LAYOUT_STORAGE_KEY]: JSON.stringify({
      v: 1,
      open: { left: true, assistant: true, console: false },
      vert: { stage: 96, console: 4 },
    }),
  });
  const restored = readLayout(() => storage);
  expect(restored).toEqual({
    kind: "saved",
    state: {
      v: 2,
      open: { nav: true, files: true, assistant: true, console: false },
    },
    dropped: [],
    migrated: true,
  });
  expect(restored.kind === "saved" && restored.state.vert).toBeUndefined();
});

it("should accept sizes the library rounded", () => {
  const raw = JSON.stringify({
    v: 2,
    open: OPEN,
    h: { assistant: 33.34, work: 66.66 },
  });
  expect(
    readLayout(() => memoryStorage({ [LAYOUT_STORAGE_KEY]: raw }))
  ).toEqual({
    kind: "saved",
    state: { v: 2, open: OPEN, h: { assistant: 33.34, work: 66.66 } },
    dropped: [],
    migrated: false,
  });
});

it("should fall back on a newer version", () => {
  const raw = JSON.stringify({
    v: 3,
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
    v: 2,
    open: { nav: true, files: true, assistant: true, console: true },
    h: { assistant: 30, work: 70 },
    w: { files: 25, center: 75 },
    vert: { stage: 60, console: 40 },
    extra: "x",
  });
  const restored = readLayout(() =>
    memoryStorage({ [LAYOUT_STORAGE_KEY]: raw })
  );
  expect(restored).toEqual({
    kind: "saved",
    state: SAVED,
    dropped: [],
    migrated: false,
  });
});

it("should store the layout as it is", () => {
  const storage = memoryStorage();
  writeLayout(() => storage, SAVED);
  expect(JSON.parse(storage.items.get(LAYOUT_STORAGE_KEY)!)).toEqual(SAVED);
});

it("should store no sizes for a folded panel, whatever the caller passes", () => {
  const storage = memoryStorage();
  writeLayout(() => storage, {
    v: 2,
    open: { nav: true, files: false, assistant: false, console: true },
    h: { assistant: 30, work: 70 },
    w: { files: 25, center: 75 },
    vert: { stage: 60, console: 40 },
  });
  expect(JSON.parse(storage.items.get(LAYOUT_STORAGE_KEY)!)).toEqual({
    v: 2,
    open: { nav: true, files: false, assistant: false, console: true },
    vert: { stage: 60, console: 40 },
  });
});

it("should tie the stored version to LAYOUT_VERSION, reading it and refusing a newer one", () => {
  const storage = memoryStorage();
  writeLayout(() => storage, DEFAULT_LAYOUT);
  expect(JSON.parse(storage.items.get(LAYOUT_STORAGE_KEY)!).v).toBe(
    LAYOUT_VERSION
  );
  expect(readLayout(() => storage).kind).toBe("saved");
  const newer = memoryStorage({
    [LAYOUT_STORAGE_KEY]: JSON.stringify({ v: LAYOUT_VERSION + 1 }),
  });
  expect(readLayout(() => newer)).toEqual({
    kind: "failed",
    reason: "version",
  });
});
