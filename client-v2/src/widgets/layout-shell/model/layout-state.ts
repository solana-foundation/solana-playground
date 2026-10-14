/** A panel group's sizes by panel id, as `onLayoutChanged` reports them (percent) */
export type PanelLayout = { [panelId: string]: number };

export const HORIZONTAL_PANELS = ["assistant", "work"] as const;
export const WORK_PANELS = ["files", "center"] as const;
export const VERTICAL_PANELS = ["stage", "console"] as const;

/** The assistant and work group's sizes; `work` holds the files and `center` */
export type HorizontalLayout = Record<typeof HORIZONTAL_PANELS[number], number>;
/** The files and `center` group's sizes, inside `work`; `center` holds the stage over the console */
export type WorkLayout = Record<typeof WORK_PANELS[number], number>;
/** The stage and console group's sizes */
export type VerticalLayout = Record<typeof VERTICAL_PANELS[number], number>;

export const LAYOUT_PANELS = ["nav", "files", "assistant", "console"] as const;
export type LayoutPanel = typeof LAYOUT_PANELS[number];

/**
 * The stored layout's version. The one place it is written: the field, the
 * defaults, the reads and the newer-version check all follow it, so the next
 * format change bumps this and finds every site.
 */
export const LAYOUT_VERSION = 2;

/**
 * What of the layout survives a reload, on this device; stored as it is.
 * Read-only throughout, so `DEFAULT_LAYOUT`, which is frozen, cannot be
 * written in place by code that compiles.
 */
export interface LayoutState {
  readonly v: typeof LAYOUT_VERSION;
  readonly open: Readonly<Record<LayoutPanel, boolean>>;
  readonly h?: Readonly<HorizontalLayout>;
  readonly w?: Readonly<WorkLayout>;
  readonly vert?: Readonly<VerticalLayout>;
}

/** The three size maps, which a reload can drop one by one */
export type SizeKey = "h" | "w" | "vert";

export const LAYOUT_STORAGE_KEY = "layout";

/**
 * The layout a first visit gets: navigation, files and assistant open,
 * console closed
 */
export const DEFAULT_LAYOUT: LayoutState = Object.freeze({
  v: LAYOUT_VERSION,
  open: Object.freeze({
    nav: true,
    files: true,
    assistant: true,
    console: false,
  }),
});

/**
 * Callers use `DEFAULT_LAYOUT` for everything but `saved`. A `saved` layout
 * whose open flags were good but a size map was not comes back without that
 * map, named in `dropped`. `migrated` says version 1 wrote the value and it
 * was converted, so the caller can save it back in the new shape;
 * `droppedH` says that value held horizontal sizes, which the conversion
 * drops on purpose (see `migrateV1`).
 */
export type Restored =
  | {
      kind: "saved";
      state: LayoutState;
      dropped: readonly SizeKey[];
      migrated: boolean;
      droppedH?: true;
    }
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
  value.v === LAYOUT_VERSION &&
  hasExactly(value.open, LAYOUT_PANELS, isBoolean);

/** The open flags version 1 stored, before the files and nav panels */
const LAYOUT_PANELS_V1 = ["left", "assistant", "console"] as const;

type OpenV1 = Record<typeof LAYOUT_PANELS_V1[number], boolean>;

/**
 * The version and open flags of a value written before the four columns;
 * `migrateV1` converts it, as nothing else reads these flags
 */
const isLayoutCoreV1 = (
  value: Record<string, unknown>
): value is Record<string, unknown> & { open: OpenV1 } =>
  value.v === 1 && hasExactly(value.open, LAYOUT_PANELS_V1, isBoolean);

/**
 * Only a whole number above this version's says a newer build wrote the
 * value; any other `v` is a value nobody's build wrote, so it is corrupt and
 * the next save repairs it
 */
const isNewerVersion = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v > LAYOUT_VERSION;

/**
 * The layout without a folded panel's sizes. The sizes are of the panel as it
 * was open, so a folded panel is sized from its flag: a fold by drag, which
 * also reports the folded sizes on release, must not reopen it on a reload.
 */
export const withoutFoldedSizes = (state: LayoutState): LayoutState => ({
  v: state.v,
  open: state.open,
  h: state.open.assistant ? state.h : undefined,
  w: state.open.files ? state.w : undefined,
  vert: state.open.console ? state.vert : undefined,
});

/** The group's layout as the library reports it, or null if a panel is missing */
export const horizontalOf = (layout: PanelLayout): HorizontalLayout | null =>
  isPanelLayout(layout, HORIZONTAL_PANELS) ? layout : null;

/** The group's layout as the library reports it, or null if a panel is missing */
export const workOf = (layout: PanelLayout): WorkLayout | null =>
  isPanelLayout(layout, WORK_PANELS) ? layout : null;

/** The group's layout as the library reports it, or null if a panel is missing */
export const verticalOf = (layout: PanelLayout): VerticalLayout | null =>
  isPanelLayout(layout, VERTICAL_PANELS) ? layout : null;

/**
 * A version 1 value as the current version: its left column is the files
 * column, and the navigation opens, since version 1 had none to fold. Its `h`
 * sized the `center` and `assistant` panels of `layout-horizontal`; that group
 * still exists, but its panels are `assistant` and `work`, so the sizes
 * name panels that are gone and mean something else. They are dropped without
 * being reported (the hook logs it at info, unreported): the assistant opens
 * at its default size.
 */
const migrateV1 = (
  parsed: Record<string, unknown> & { open: OpenV1 }
): Restored => {
  const vert =
    parsed.vert === undefined || isPanelLayout(parsed.vert, VERTICAL_PANELS)
      ? parsed.vert
      : null;
  const state = withoutFoldedSizes({
    v: LAYOUT_VERSION,
    open: {
      nav: true,
      files: parsed.open.left,
      assistant: parsed.open.assistant,
      console: parsed.open.console,
    },
    h: undefined,
    w: undefined,
    vert: vert ?? undefined,
  });
  return {
    kind: "saved",
    state,
    dropped: vert === null ? ["vert"] : [],
    migrated: true,
    droppedH: parsed.h === undefined ? undefined : true,
  };
};

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
  if (isLayoutCoreV1(parsed)) return migrateV1(parsed);
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
  const w =
    parsed.w === undefined || isPanelLayout(parsed.w, WORK_PANELS)
      ? parsed.w
      : null;
  const vert =
    parsed.vert === undefined || isPanelLayout(parsed.vert, VERTICAL_PANELS)
      ? parsed.vert
      : null;
  const dropped: SizeKey[] = [];
  if (h === null) dropped.push("h");
  if (w === null) dropped.push("w");
  if (vert === null) dropped.push("vert");
  // Field by field, so a key this version does not know is not carried along
  const state = withoutFoldedSizes({
    v: LAYOUT_VERSION,
    open: {
      nav: parsed.open.nav,
      files: parsed.open.files,
      assistant: parsed.open.assistant,
      console: parsed.open.console,
    },
    h: h ?? undefined,
    w: w ?? undefined,
    vert: vert ?? undefined,
  });
  return { kind: "saved", state, dropped, migrated: false };
};

/**
 * Saves the layout without a folded panel's sizes, whoever calls; a storage
 * that throws is returned, never thrown
 */
export const writeLayout = (
  storage: () => Pick<Storage, "setItem">,
  state: LayoutState
): { ok: true } | { ok: false; error: unknown } => {
  try {
    storage().setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify(withoutFoldedSizes(state))
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
};
