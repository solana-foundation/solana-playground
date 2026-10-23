import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronsLeft,
  ChevronsRight,
  Ellipsis,
  Lock,
  UnfoldVertical,
  XIcon,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";

import { Segmented, SegmentedItem } from "@/shared/ui/segmented";

/* Two devices changed the same lines: this device on the left, the result
   in the middle, the other device on the right, after IntelliJ IDEA's
   Merge Revisions. It draws what it is given. The editors inside the panes,
   the text, the diff and the scrolling are the app's; the ribbons are drawn
   from the offsets the app measures. At phone width (a container query, so
   it follows the box it sits in, not the window) one pane shows at a time,
   picked with MergePaneTabs. */

type MergeSide = "left" | "result" | "right";

const PANE_NAME: Record<MergeSide, string> = {
  left: "This device",
  result: "Result",
  right: "Other device",
};

type MergeCtx = {
  pane: MergeSide;
  setPane: (pane: MergeSide) => void;
  id: string;
};
const MergeContext = React.createContext<MergeCtx>({
  pane: "result",
  setPane: () => {},
  id: "",
});

function Merge({
  className,
  pane: paneProp,
  defaultPane = "result",
  onPaneChange,
  ...props
}: React.ComponentProps<"div"> & {
  /** the pane shown at phone width */
  pane?: MergeSide;
  defaultPane?: MergeSide;
  onPaneChange?: (pane: MergeSide) => void;
}) {
  const [inner, setInner] = React.useState<MergeSide>(defaultPane);
  const pane = paneProp ?? inner;
  const id = React.useId();
  const setPane = React.useCallback(
    (next: MergeSide) => {
      setInner(next);
      onPaneChange?.(next);
    },
    [onPaneChange]
  );
  return (
    <MergeContext.Provider value={{ pane, setPane, id }}>
      <div
        data-slot="merge"
        className={cn(
          "group/merge @container/merge flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden text-foreground",
          className
        )}
        {...props}
      />
    </MergeContext.Provider>
  );
}

/* ── the bar along the top ─────────────────────────────────────────────── */

function MergeToolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="merge-toolbar"
      className={cn(
        "flex min-h-11 shrink-0 flex-wrap items-center gap-x-1 gap-y-1 border-b border-border px-2 py-1.5",
        className
      )}
      {...props}
    />
  );
}

const NAV = {
  "previous-conflict": { label: "Previous conflict", Icon: ArrowUp },
  "next-conflict": { label: "Next conflict", Icon: ArrowDown },
  "previous-file": { label: "Previous file", Icon: ArrowLeft },
  "next-file": { label: "Next file", Icon: ArrowRight },
} as const;

function MergeNav({
  className,
  to,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  to: keyof typeof NAV;
}) {
  const { label, Icon } = NAV[to];
  return (
    <button
      type="button"
      data-slot="merge-nav"
      data-to={to}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [@media(hover:none)]:size-9",
        className
      )}
      {...props}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

/* The file, and which of how many when there is more than one */
function MergeTitle({
  className,
  path,
  index,
  total,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  path: string;
  index?: number;
  total?: number;
}) {
  return (
    <div
      data-slot="merge-title"
      className={cn(
        "flex min-w-0 flex-1 basis-32 items-baseline gap-2 px-1 @max-3xl/merge:order-first @max-3xl/merge:basis-full @max-3xl/merge:py-1",
        className
      )}
      {...props}
    >
      <span className="min-w-0 truncate font-mono text-[0.8125rem] text-foreground">
        {path}
      </span>
      {index != null && total != null && total > 1 && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          file {index} of {total}
        </span>
      )}
    </div>
  );
}

/* How many hunks are left to decide. Polite live text, so a screen reader
   hears it fall */
function MergeCount({
  className,
  count,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & { count: number }) {
  const done = count === 0;
  return (
    <span
      role="status"
      data-slot="merge-count"
      data-done={done || undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 px-1.5 text-xs text-muted-foreground tabular-nums",
        className
      )}
      {...props}
    >
      {done ? (
        <Check aria-hidden className="size-3.5 text-success" />
      ) : (
        <span aria-hidden className="size-1.5 rounded-full bg-error" />
      )}
      {done
        ? "No conflicts left"
        : `${count} ${count === 1 ? "conflict" : "conflicts"} left`}
    </span>
  );
}

/* Unfolds every region. The words go at phone width; the name stays */
function MergeShowAll({
  className,
  pressed: pressedProp,
  defaultPressed = false,
  onPressedChange,
  onClick,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
}) {
  const [inner, setInner] = React.useState(defaultPressed);
  const pressed = pressedProp ?? inner;
  return (
    <button
      type="button"
      data-slot="merge-show-all"
      aria-pressed={pressed}
      data-state={pressed ? "on" : "off"}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        setInner(!pressed);
        onPressedChange?.(!pressed);
      }}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-primary/12 data-[state=on]:text-foreground [@media(hover:none)]:h-9",
        className
      )}
      {...props}
    >
      <UnfoldVertical aria-hidden className="size-3.5" />
      <span className="@max-3xl/merge:sr-only">Show all lines</span>
    </button>
  );
}

/* ── the panes ─────────────────────────────────────────────────────────── */

/* At phone width, which pane shows: one toggle button per pane, the shown
   one pressed, in a named group. Not tabs: the panes are not tabpanels and
   the group does not rove with the arrow keys, so each button is its own tab
   stop. Built on Segmented, with its radio roles and roving focus turned off */
function MergePaneTabs({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children">) {
  const { pane, setPane, id } = React.useContext(MergeContext);
  return (
    <div
      data-slot="merge-pane-tabs"
      className={cn(
        "hidden shrink-0 border-b border-border px-3 py-2 @max-3xl/merge:block",
        className
      )}
      {...props}
    >
      <Segmented
        role="group"
        aria-label="Panes"
        rovingFocus={false}
        value={pane}
        onValueChange={(v) => setPane(v as MergeSide)}
        className="w-full"
      >
        {(["left", "result", "right"] as const).map((side) => (
          <SegmentedItem
            key={side}
            value={side}
            role={undefined}
            aria-checked={undefined}
            aria-pressed={pane === side}
            aria-controls={`${id}-${side}`}
            className="flex-1"
          >
            {PANE_NAME[side]}
          </SegmentedItem>
        ))}
      </Segmented>
    </div>
  );
}

/* pane | ribbon | pane | ribbon | pane, or one pane at phone width */
function MergePanes({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="merge-panes"
      className={cn(
        "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] bg-surface-panel @max-3xl/merge:grid-cols-1",
        className
      )}
      {...props}
    />
  );
}

type PaneCtx = { side: MergeSide; readOnly: boolean; deleted: boolean };
const PaneContext = React.createContext<PaneCtx>({
  side: "result",
  readOnly: false,
  deleted: false,
});

function MergePane({
  className,
  side,
  readOnly = side !== "result",
  deleted = false,
  ...props
}: React.ComponentProps<"section"> & {
  side: MergeSide;
  /** the sides are read-only, and say so with a lock; the result is not */
  readOnly?: boolean;
  /** this side deleted the file: the pane is empty and says so */
  deleted?: boolean;
}) {
  const { pane, id } = React.useContext(MergeContext);
  return (
    <PaneContext.Provider value={{ side, readOnly, deleted }}>
      <section
        id={`${id}-${side}`}
        aria-label={PANE_NAME[side]}
        data-slot="merge-pane"
        data-side={side}
        data-current={pane === side}
        data-read-only={readOnly || undefined}
        data-deleted={deleted || undefined}
        className={cn(
          "flex min-h-0 min-w-0 flex-col @max-3xl/merge:data-[current=false]:hidden",
          className
        )}
        {...props}
      />
    </PaneContext.Provider>
  );
}

/* A side that deleted the file says so in place of its name */
const DELETED_NAME: Record<MergeSide, string> = {
  left: "Deleted on this device",
  result: PANE_NAME.result,
  right: "Deleted on the other device",
};

/* The pane's name, with a lock on a read-only side. Anything else, such as
   a version, goes after it */
function MergePaneHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { side, readOnly, deleted } = React.useContext(PaneContext);
  const label = deleted ? DELETED_NAME[side] : PANE_NAME[side];
  return (
    <div
      data-slot="merge-pane-header"
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 text-xs font-act text-muted-foreground",
        side === "result" && "text-foreground",
        className
      )}
      {...props}
    >
      {readOnly && (
        <>
          <Lock aria-hidden className="size-3 shrink-0 text-subtle" />
          <span className="sr-only">Read-only:</span>
        </>
      )}
      <span className={cn("truncate", deleted && "text-error")}>{label}</span>
      {children}
    </div>
  );
}

/* An empty slot on the editor's ground, a row beside the pane's
   MergeHunkGutter. The app mounts its editor in it as a flex-1 child. A
   deleted side is hatched */
function MergePaneBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="merge-pane-body"
      className={cn(
        "relative flex min-h-0 flex-1 overflow-hidden bg-surface-base",
        "in-data-deleted:bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--border)_6px_7px)]",
        className
      )}
      {...props}
    />
  );
}

/* ── hunks ─────────────────────────────────────────────────────────────── */

/* A side's column for its hunk controls, next to the ribbon they act
   across: the last thing in "This device", the first in "Other device", so
   the two read as mirror images and no control covers code. The app places
   each MergeHunkActions in it at its hunk's height. At phone width, where
   the result carries every control, it is not drawn. Place it in the DOM
   where it shows -- last in the left pane's body, first in the right's --
   so the tab order follows what the eye sees; the order classes only
   guard the look */
function MergeHunkGutter({ className, ...props }: React.ComponentProps<"div">) {
  const { side } = React.useContext(PaneContext);
  return (
    <div
      data-slot="merge-hunk-gutter"
      data-side={side}
      className={cn(
        "relative w-11 shrink-0 overflow-hidden bg-surface-panel @max-3xl/merge:hidden",
        side === "left"
          ? "order-last border-l border-border"
          : "order-first border-r border-border",
        className
      )}
      {...props}
    />
  );
}

/* A hunk's colour, by how it stands. Plain classes on a line, so the app
   can hand the same names to its editor's line decorations:
   conflict   both devices changed it, not yet decided    error
   changed    one device changed it, merged on its own    info
   resolved   taken into the result                       success
   dismissed  left out of the result                      muted */
const mergeHunkVariants = cva("", {
  variants: {
    state: {
      conflict: "bg-error/12 shadow-[inset_2px_0_0_var(--color-error)]",
      changed: "bg-info/10 shadow-[inset_2px_0_0_var(--color-info)]",
      resolved: "bg-success/10 shadow-[inset_2px_0_0_var(--color-success)]",
      dismissed:
        "bg-muted-foreground/8 shadow-[inset_2px_0_0_var(--color-muted-foreground)]",
    },
  },
  defaultVariants: {
    state: "conflict",
  },
});

type MergeHunkState = NonNullable<
  VariantProps<typeof mergeHunkVariants>["state"]
>;

/* The same states in words, for whatever the colour alone cannot tell: a
   screen reader, a tooltip, a hover on the app's line decorations */
const mergeHunkStateText: Record<MergeHunkState, string> = {
  conflict: "both devices changed these lines, not yet decided",
  changed: "changed on one device, merged on its own",
  resolved: "taken into the result",
  dismissed: "left out of the result",
};

/* A hunk's controls as a named group, when the app says which hunk and how it
   stands: "Conflict 2 of 5: both devices changed these lines, not yet decided" */
function hunkGroup(
  hunk: string | undefined,
  state: MergeHunkState | undefined
) {
  if (!hunk && !state) return {};
  const words = [hunk, state && mergeHunkStateText[state]]
    .filter(Boolean)
    .join(": ");
  return {
    role: "group",
    "aria-label": words.charAt(0).toUpperCase() + words.slice(1),
    "data-state": state,
  };
}

/* The ribbon's bands, in the same palette */
const BAND: Record<MergeHunkState, string> = {
  conflict: "fill-error/15 stroke-error/70",
  changed: "fill-info/12 stroke-info/60",
  resolved: "fill-success/12 stroke-success/60",
  dismissed: "fill-muted-foreground/10 stroke-muted-foreground/45",
};

type MergeBand = {
  /** the hunk's span in the pane on the left of the ribbon, in px from the top of its body */
  fromTop: number;
  fromBottom: number;
  /** and in the pane on its right */
  toTop: number;
  toBottom: number;
  state: MergeHunkState;
};

const RIBBON = 40;

/* The bands that join a hunk across two panes. Offsets are pixels from the
   top of the pane bodies, already scrolled; a band of no height is a line,
   for lines one side added and the other has not */
function MergeRibbon({
  className,
  bands,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & { bands: MergeBand[] }) {
  const c = RIBBON / 2;
  return (
    <div
      aria-hidden
      data-slot="merge-ribbon"
      className={cn(
        "flex w-10 min-h-0 flex-col border-x border-border bg-surface-panel @max-3xl/merge:hidden",
        className
      )}
      {...props}
    >
      <div className="h-9 shrink-0 border-b border-border" />
      <svg width={RIBBON} className="block min-h-0 w-10 flex-1 overflow-hidden">
        {bands.map((b, i) => (
          <g key={i} data-state={b.state} className={BAND[b.state]}>
            <path
              strokeWidth={0}
              d={`M0 ${b.fromTop}C${c} ${b.fromTop} ${c} ${b.toTop} ${RIBBON} ${b.toTop}L${RIBBON} ${b.toBottom}C${c} ${b.toBottom} ${c} ${b.fromBottom} 0 ${b.fromBottom}Z`}
            />
            <path
              fill="none"
              strokeWidth={1}
              d={`M0 ${b.fromTop + 0.5}C${c} ${b.fromTop + 0.5} ${c} ${
                b.toTop + 0.5
              } ${RIBBON} ${b.toTop + 0.5}M0 ${b.fromBottom - 0.5}C${c} ${
                b.fromBottom - 0.5
              } ${c} ${b.toBottom - 0.5} ${RIBBON} ${b.toBottom - 0.5}`}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

/* The controls on a hunk, small enough for an editor's gutter. Given the
   hunk ("conflict 2 of 5") or its state, they are a group named by both */
function MergeHunkActions({
  className,
  hunk,
  state,
  ...props
}: React.ComponentProps<"div"> & { hunk?: string; state?: MergeHunkState }) {
  return (
    <div
      data-slot="merge-hunk-actions"
      {...hunkGroup(hunk, state)}
      className={cn("inline-flex items-center gap-px", className)}
      {...props}
    />
  );
}

const HUNK_ACTION = {
  take: {
    left: "Take this device's lines",
    right: "Take the other device's lines",
  },
  dismiss: {
    left: "Dismiss this device's lines",
    right: "Dismiss the other device's lines",
  },
} as const;

const TAKE_ICON = { left: ChevronsRight, right: ChevronsLeft } as const;

/* A side's two controls in order, mirrored about the result: take sits
   nearest it, so this device's read × » and the other device's « ×. Render
   them in this order so focus moves the way the eye does */
const mergeHunkOrder: Record<
  "left" | "right",
  readonly ["take" | "dismiss", "take" | "dismiss"]
> = {
  left: ["dismiss", "take"],
  right: ["take", "dismiss"],
};

/* » takes this device's lines, « the other device's; × dismisses either.
   Lay a side's pair out by mergeHunkOrder. The name says the action and the
   side; given the hunk ("conflict 2 of 5") it says which, so a list of the
   page's buttons does not read the same name once per hunk. The tooltip
   stays short */
function MergeHunkAction({
  className,
  action,
  from,
  hunk,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  action: "take" | "dismiss";
  from: "left" | "right";
  /** which hunk, in words: "conflict 2 of 5" */
  hunk?: string;
}) {
  const label = HUNK_ACTION[action][from];
  const Icon = action === "dismiss" ? XIcon : TAKE_ICON[from];
  return (
    <button
      type="button"
      data-slot="merge-hunk-action"
      data-action={action}
      data-from={from}
      aria-label={hunk ? `${label}, ${hunk}` : label}
      title={label}
      className={cn(
        "grid size-4.5 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [@media(hover:none)]:size-8",
        action === "take" && "text-foreground",
        className
      )}
      {...props}
    >
      <Icon aria-hidden className="size-3.5" />
    </button>
  );
}

/* At phone width, where the result carries both sides' controls, a row of
   its own under the hunk, so no control covers the lines it decides. Each
   side's controls go in a MergeHunkBarSide, named, since a touch screen
   shows no tooltips to tell one × from the other. Given the hunk or its
   state, it is a group named by both, as MergeHunkActions */
function MergeHunkBar({
  className,
  hunk,
  state,
  ...props
}: React.ComponentProps<"div"> & { hunk?: string; state?: MergeHunkState }) {
  return (
    <div
      data-slot="merge-hunk-bar"
      {...hunkGroup(hunk, state)}
      className={cn(
        "flex h-11 items-center justify-between gap-2 border-y border-border bg-surface-panel px-2 font-sans",
        className
      )}
      {...props}
    />
  );
}

/* One side's controls in a MergeHunkBar, mirrored as in the gutters: this
   device's name, then × »; then « ×, then the other device's name */
function MergeHunkBarSide({
  className,
  side,
  children,
  ...props
}: React.ComponentProps<"div"> & { side: "left" | "right" }) {
  const name = (
    <span className="truncate text-xs font-act text-muted-foreground">
      {PANE_NAME[side]}
    </span>
  );
  return (
    <div
      data-slot="merge-hunk-bar-side"
      data-side={side}
      className={cn("flex min-w-0 items-center gap-1", className)}
      {...props}
    >
      {side === "left" && name}
      <MergeHunkActions>{children}</MergeHunkActions>
      {side === "right" && name}
    </div>
  );
}

/* A run of lines no hunk touches, folded. Pressing it is the app's */
function MergeFold({
  className,
  count,
  children,
  ...props
}: React.ComponentProps<"button"> & { count: number }) {
  return (
    <button
      type="button"
      data-slot="merge-fold"
      className={cn(
        "flex h-6 w-full items-center gap-2 border-y border-dashed border-border bg-surface-panel px-3 text-left text-xs text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        className
      )}
      {...props}
    >
      <Ellipsis aria-hidden className="size-3.5 shrink-0" />
      {children ?? `${count} unchanged ${count === 1 ? "line" : "lines"}`}
    </button>
  );
}

/* ── the bar along the bottom ──────────────────────────────────────────── */

/* The whole-file shortcuts on the left, Cancel and Apply on the right */
function MergeFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="merge-footer"
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5",
        className
      )}
      {...props}
    />
  );
}

function MergeFooterShortcuts({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="merge-footer-shortcuts"
      className={cn(
        "flex flex-wrap items-center gap-2 @max-3xl/merge:w-full @max-3xl/merge:*:flex-1",
        className
      )}
      {...props}
    />
  );
}

function MergeFooterActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="merge-footer-actions"
      className={cn(
        "ml-auto flex items-center gap-2 @max-3xl/merge:w-full @max-3xl/merge:*:flex-1",
        className
      )}
      {...props}
    />
  );
}

export {
  Merge,
  MergeCount,
  MergeFold,
  MergeFooter,
  MergeFooterActions,
  MergeFooterShortcuts,
  MergeHunkAction,
  MergeHunkActions,
  MergeHunkBar,
  MergeHunkBarSide,
  MergeHunkGutter,
  mergeHunkOrder,
  mergeHunkStateText,
  mergeHunkVariants,
  MergeNav,
  MergePane,
  MergePaneBody,
  MergePaneHeader,
  MergePanes,
  MergePaneTabs,
  MergeRibbon,
  MergeShowAll,
  MergeTitle,
  MergeToolbar,
};
export type { MergeBand, MergeHunkState, MergeSide };
