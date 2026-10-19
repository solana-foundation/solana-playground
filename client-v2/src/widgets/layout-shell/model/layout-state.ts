/** A panel group's sizes by panel id, as `onLayoutChanged` reports them (percent) */
export type PanelLayout = { [panelId: string]: number };

export const HORIZONTAL_PANELS = ["center", "assistant"] as const;
export const VERTICAL_PANELS = ["stage", "console"] as const;

/** The centre and assistant group's sizes */
export type HorizontalLayout = Record<typeof HORIZONTAL_PANELS[number], number>;
/** The stage and console group's sizes */
export type VerticalLayout = Record<typeof VERTICAL_PANELS[number], number>;

export const LAYOUT_PANELS = ["left", "assistant", "console"] as const;
export type LayoutPanel = typeof LAYOUT_PANELS[number];

/**
 * What of the layout survives a reload, on this device; stored as it is.
 * Read-only throughout, so `DEFAULT_LAYOUT`, which is frozen, cannot be
 * written in place by code that compiles.
 */
export interface LayoutState {
  readonly v: 1;
  readonly open: Readonly<Record<LayoutPanel, boolean>>;
  readonly h?: Readonly<HorizontalLayout>;
  readonly vert?: Readonly<VerticalLayout>;
}

/** The two size maps, which a reload can drop one by one */
export type SizeKey = "h" | "vert";

export const LAYOUT_STORAGE_KEY = "layout";

/** The layout a first visit gets: left open, assistant open, console closed */
export const DEFAULT_LAYOUT: LayoutState = Object.freeze({
  v: 1,
  open: Object.freeze({ left: true, assistant: true, console: false }),
});

/**
 * Callers use `DEFAULT_LAYOUT` for everything but `saved`. A `saved` layout
 * whose open flags were good but a size map was not comes back without that
 * map, named in `dropped`.
 */
export type Restored =
  | { kind: "saved"; state: LayoutState; dropped: readonly SizeKey[] }
  | { kind: "none" }
  | { kind: "failed"; reason: "version" }
  | {
      kind: "failed";
      reason: "corrupt" | "storage-unavailable";
      error: unknown;
    };

/** Why a saved layout was not used */
export type RestoreFailure = Extract<Restored, { kind: "failed" }>["reason"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSize = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;

/** Exactly these keys, each value passing `isValue` */
const hasExactly = <Id extends string, V>(
  value: unknown,
  ids: readonly Id[],
  isValue: (item: unknown) => item is V
): value is Record<Id, V> => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.join() === [...ids].sort().join() &&
    keys.every((key) => isValue(value[key]))
  );
};

const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

/**
 * The library reports sizes that sum to 100, rounded, so anything further
 * off was not written by it
 */
const SUM_TOLERANCE = 1;

/**
 * Exactly the group's panel ids, each a size in percent, together the whole
 * group. Whether a size agrees with the panel's fold flag is not checked: a
 * folded panel is a fixed width in px, which is a different percent on every
 * window.
 */
const isPanelLayout = <Id extends string>(
  value: unknown,
  ids: readonly Id[]
): value is Record<Id, number> =>
  hasExactly(value, ids, isSize) &&
  Math.abs(Object.values<number>(value).reduce((a, b) => a + b, 0) - 100) <=
    SUM_TOLERANCE;

/** The version and the open flags: what decides whether the value is used */
const isLayoutCore = (
  value: Record<string, unknown>
): value is Record<string, unknown> & Pick<LayoutState, "v" | "open"> =>
  value.v === 1 && hasExactly(value.open, LAYOUT_PANELS, isBoolean);

/**
 * Only a whole number above this version's says a newer build wrote the
 * value; any other `v` is a value nobody's build wrote, so it is corrupt and
 * the next save repairs it
 */
const isNewerVersion = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v > 1;

/**
 * The layout without a folded panel's sizes. The sizes are of the panel as it
 * was open, so a folded panel is sized from its flag: a fold by drag, which
 * also reports the folded sizes on release, must not reopen it on a reload.
 */
export const withoutFoldedSizes = (state: LayoutState): LayoutState => ({
  v: state.v,
  open: state.open,
  h: state.open.assistant ? state.h : undefined,
  vert: state.open.console ? state.vert : undefined,
});

/** The group's layout as the library reports it, or null if a panel is missing */
export const horizontalOf = (layout: PanelLayout): HorizontalLayout | null =>
  isPanelLayout(layout, HORIZONTAL_PANELS) ? layout : null;

/** The group's layout as the library reports it, or null if a panel is missing */
export const verticalOf = (layout: PanelLayout): VerticalLayout | null =>
  isPanelLayout(layout, VERTICAL_PANELS) ? layout : null;

/**
 * The saved layout, or the defaults and why. Never throws: storage that
 * cannot be reached is a reason, not a crash.
 */
export const readLayout = (
  storage: () => Pick<Storage, "getItem">
): Restored => {
  let raw: string | null;
  try {
    raw = storage().getItem(LAYOUT_STORAGE_KEY);
  } catch (error) {
    return { kind: "failed", reason: "storage-unavailable", error };
  }
  if (raw === null) return { kind: "none" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { kind: "failed", reason: "corrupt", error };
  }
  if (!isRecord(parsed)) {
    return {
      kind: "failed",
      reason: "corrupt",
      error: new Error("Not an object"),
    };
  }
  if (isNewerVersion(parsed.v)) return { kind: "failed", reason: "version" };
  if (!isLayoutCore(parsed)) {
    return {
      kind: "failed",
      reason: "corrupt",
      error: new Error("Unexpected shape"),
    };
  }
  // A bad size map loses only itself: its panel then opens at its default
  // size, and the open flags, which the user chose, are kept
  const h =
    parsed.h === undefined || isPanelLayout(parsed.h, HORIZONTAL_PANELS)
      ? parsed.h
      : null;
  const vert =
    parsed.vert === undefined || isPanelLayout(parsed.vert, VERTICAL_PANELS)
      ? parsed.vert
      : null;
  const dropped: SizeKey[] = [];
  if (h === null) dropped.push("h");
  if (vert === null) dropped.push("vert");
  // Field by field, so a key this version does not know is not carried along
  const state = withoutFoldedSizes({
    v: 1,
    open: {
      left: parsed.open.left,
      assistant: parsed.open.assistant,
      console: parsed.open.console,
    },
    h: h ?? undefined,
    vert: vert ?? undefined,
  });
  return { kind: "saved", state, dropped };
};

/** Saves the layout; a storage that throws is returned, never thrown */
export const writeLayout = (
  storage: () => Pick<Storage, "setItem">,
  state: LayoutState
): { ok: true } | { ok: false; error: unknown } => {
  try {
    storage().setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/layout-shell/model/layout-state", () => {
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
      [
        "sizes just past the tolerance",
        { h: { center: 70, assistant: 31.01 } },
      ],
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
  });
}
