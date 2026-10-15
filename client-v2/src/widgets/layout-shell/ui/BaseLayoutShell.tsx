import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject, ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";
import type { PanelImperativeHandle } from "react-resizable-panels";

import type { Viewport } from "@/shared/lib/hooks/use-viewport";
import { createLogger } from "@/shared/lib/logger";
import type { Disposable } from "@/utils/types";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/shared/ui/sidebar";
import { BOTTOM_BAR_PX, GAP } from "@/views/flow/tokens";
import type {
  HorizontalLayout,
  PanelLayout,
  VerticalLayout,
} from "../model/layout-state";

/**
 * Sizes in px; the design system gives the left panel's in rem
 * (`SIDEBAR_STYLE`). The console folds to its handle, the bar
 * `ConsoleDrawer` draws at `BOTTOM_BAR_PX`.
 */
export const PANEL_SIZES = {
  assistant: { default: 348, min: 280, max: 560, folded: 24 },
  console: { default: 256, min: 120, folded: BOTTOM_BAR_PX },
  centerMin: 320,
} as const;

/** 14.5 rem open and 3.25 rem as a rail, as the design system's migration map has it */
const SIDEBAR_STYLE = {
  "--sidebar-width": "14.5rem",
  "--sidebar-width-icon": "3.25rem",
} as CSSProperties;

/**
 * Same variants as `shared/ui/sheet`'s own `data-[side=right]:w-3/4
 * data-[side=right]:sm:max-w-sm`: an unprefixed `w-full` loses to them
 */
const SHEET_WIDTH: Record<Exclude<Viewport, "wide">, string> = {
  compact:
    "data-[side=right]:w-[21.75rem] data-[side=right]:sm:max-w-[21.75rem]",
  phone: "data-[side=right]:w-full data-[side=right]:sm:max-w-full",
};

export interface PanelState {
  open: boolean;
  /** Called for the user's own change only: a drag, a key, a tap */
  onOpenChange: (open: boolean) => void;
}

export interface BaseLayoutShellProps {
  viewport: Viewport;
  leftOpen: boolean;
  onLeftOpenChange: (open: boolean) => void;
  /**
   * The assistant's open state, which follows the viewport: the panel on a
   * wide screen (`onOpenChange` is a drag folding or unfolding it), the Sheet
   * below `LAYOUT_BREAKPOINTS.compact`
   */
  assistantState: PanelState;
  /** The console is folded or unfolded by dragging */
  consoleState: PanelState;
  horizontal?: HorizontalLayout;
  vertical?: VerticalLayout;
  onHorizontalLayout: (layout: PanelLayout) => void;
  onVerticalLayout: (layout: PanelLayout) => void;
  /**
   * Renders the left panel's content. It is handed the stock Sidebar's toggle
   * (which opens the Sheet below `LAYOUT_BREAKPOINTS.left`) and whether the
   * Sidebar is in that Sheet mode.
   */
  left: (stock: { toggle: () => void; isMobile: boolean }) => ReactNode;
  /**
   * Below `LAYOUT_BREAKPOINTS.left`: the left panel's Sheet opened or closed.
   * Not folded into one open/onOpenChange pair with `leftOpen`: the stock
   * Sidebar keeps the Sheet's state (`openMobile`) to itself and takes no prop
   * for it, so the two modes cannot be one controlled value.
   */
  onLeftSheetChange: (open: boolean) => void;
  /**
   * Below `LAYOUT_BREAKPOINTS.left`: closes the left panel's Sheet each time
   * `close` is called, for as long as the returned disposable lives. The
   * Sheet is a modal dialog that traps focus, so a modal opened from the file
   * tree (rename, delete) could not be typed into while it stays open.
   * `close` returns whether it closed anything: on a wider window the stock
   * Sidebar can still hold the Sheet as open from before, but shows no Sheet.
   * Pass a stable function: a new one each render resubscribes each render.
   */
  closeLeftSheetOn: (close: () => boolean) => Disposable;
  stage: ReactNode;
  console: ReactNode;
  assistant: ReactNode;
  /**
   * Below `LAYOUT_BREAKPOINTS.compact`: what opens the assistant Sheet, on the
   * right edge
   */
  assistantOpener: ReactNode;
  /**
   * The font a Sheet's content is set in. Sheets portal outside the app
   * wrapper that sets it, so they would fall back to the browser's.
   */
  sheetFont?: CSSProperties;
}

const log = createLogger("layout-shell:panels");

/** What the library's `isCollapsed()` throws until a panel registers */
const NOT_REGISTERED = "Panel constraints not found";

type FoldedOf = (
  panel: { isCollapsed(): boolean } | null | undefined
) => boolean | undefined;

/**
 * Whether the panel is folded, or `undefined` while it cannot say: the
 * library's `isCollapsed()` throws until the panel is registered with its
 * group, and a throw here would reach only the app-wide error boundary. That
 * one is expected; any other error is reported, once per shell, since it runs
 * on every resize frame and would leave the toggles doing nothing.
 */
const createFoldedOf = (): FoldedOf => {
  let reported = false;
  return (panel) => {
    if (!panel) return undefined;
    try {
      return panel.isCollapsed();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(NOT_REGISTERED)) {
        log.debug(
          "A panel was asked whether it is folded before it registered"
        );
      } else if (!reported) {
        reported = true;
        log.error(error, { report: true, context: { call: "isCollapsed" } });
      }
      return undefined;
    }
  };
};

const LeftSlot = ({
  render,
}: {
  render: (stock: { toggle: () => void; isMobile: boolean }) => ReactNode;
}) => {
  const { toggleSidebar, isMobile } = useSidebar();
  return <>{render({ toggle: toggleSidebar, isMobile })}</>;
};

/**
 * Below `LAYOUT_BREAKPOINTS.left` the stock Sidebar is a Sheet nothing else
 * opens, so this renders its opener at the left edge and reports the Sheet
 * opening and closing (not the value it starts with).
 */
const LeftSheetOpener = ({
  onChange,
  closeOn,
}: {
  onChange: (open: boolean) => void;
  closeOn: (close: () => boolean) => Disposable;
}) => {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const previous = useRef(openMobile);
  const shown = useRef(false);
  shown.current = isMobile && openMobile;
  useEffect(() => {
    if (previous.current === openMobile) return;
    previous.current = openMobile;
    onChange(openMobile);
  }, [openMobile, onChange]);
  useEffect(() => {
    const sub = closeOn(() => {
      if (!shown.current) return false;
      setOpenMobile(false);
      return true;
    });
    return () => sub.dispose();
  }, [closeOn, setOpenMobile]);
  if (!isMobile) return null;
  return (
    <div className="absolute top-1 left-0 z-10">
      <button
        type="button"
        aria-label="Expand project panel"
        className="rounded-r-md border border-l-0 border-border bg-card px-1.5 py-2 text-muted-foreground hover:text-foreground"
        onClick={() => setOpenMobile(true)}
      >
        &#8250;
      </button>
    </div>
  );
};

/**
 * The area under Flow's header: the left panel as the stock Sidebar, the stage
 * over the console, and the assistant beside them on a wide screen or in a
 * Sheet below `LAYOUT_BREAKPOINTS.compact`. Lays out what it is given; holds no
 * state.
 */
const BaseLayoutShell = (props: BaseLayoutShellProps) => {
  const [foldedOf] = useState(createFoldedOf);
  const assistantRef = usePanelRef();
  const consoleRef = usePanelRef();
  // The size each panel last had open, in px. Opening goes through
  // `resize(openSize)`, not `expand()`: `expand()` restores a size the panel
  // had before it folded, and a panel that mounted folded never had one, so it
  // would open at its minimum instead of its default.
  const assistantOpenSize = useRef<number>(PANEL_SIZES.assistant.default);
  const consoleOpenSize = useRef<number>(PANEL_SIZES.console.default);

  // Whether each group has settled its first layout on its own, which a
  // restore can leave disagreeing with the panel's flag
  const assistantSettled = useRef(false);
  const consoleSettled = useRef(false);

  // `open` props drive the panels; a drag that folds one reports back through
  // `settle` on release, so the two never disagree for long. A panel that
  // mounts again on a wide screen starts at its `defaultSize`, which follows
  // `assistantState.open`, so nothing re-syncs it here: on that first run the
  // panel's handle is not yet registered with its group, and its
  // `isCollapsed()` throws "Panel constraints not found". The flag follows the
  // viewport, so crossing `LAYOUT_BREAKPOINTS.compact` changes it too: that
  // change is skipped. `assistantSeen` is the viewport of the last render the
  // effect below saw, renewed by its own effect after it so that every viewport
  // change reaches it, not only the ones that also change the flag.
  const assistantSeen = useRef(props.viewport);
  useEffect(() => {
    const panel = assistantRef.current;
    if (props.viewport !== "wide" || assistantSeen.current !== "wide") return;
    const folded = foldedOf(panel);
    if (!panel || folded === undefined) return;
    if (folded === !props.assistantState.open) return;
    if (props.assistantState.open) panel.resize(assistantOpenSize.current);
    else panel.collapse();
    // The viewport is read, not a trigger: its changes are the ones skipped
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.assistantState.open, assistantRef]);
  useEffect(() => {
    assistantSeen.current = props.viewport;
    // The panel mounts again on the way back to wide, and settles again
    if (props.viewport !== "wide") assistantSettled.current = false;
  }, [props.viewport]);

  useEffect(() => {
    const panel = consoleRef.current;
    const folded = foldedOf(panel);
    if (!panel || folded === undefined) return;
    if (folded === !props.consoleState.open) return;
    if (props.consoleState.open) panel.resize(consoleOpenSize.current);
    else panel.collapse();
  }, [props.consoleState.open, consoleRef, foldedOf]);

  /**
   * A group reported a finished layout. A drag folding or unfolding the panel
   * is the user's change, so it is reported and the layout saved. The library
   * also settles a layout on its own, on mount and on a window resize: those
   * are not choices, and saving them would pin the sizes of whatever window
   * the page last opened in. The first of them can disagree with the flag
   * (a restored size below the library's fold point mounts folded), and the
   * flag decides, so the panel is put back once rather than the flag
   * rewritten as if dragged.
   */
  const settle = (
    group: {
      panel: PanelImperativeHandle | null;
      state: PanelState;
      openSize: number;
      settledOnce: MutableRefObject<boolean>;
      save: (layout: PanelLayout) => void;
    },
    layout: PanelLayout,
    meta: { isUserInteraction: boolean }
  ) => {
    const folded = foldedOf(group.panel);
    const disagrees = folded !== undefined && folded === group.state.open;
    if (meta.isUserInteraction) {
      if (disagrees) group.state.onOpenChange(!folded);
      group.save(layout);
      return;
    }
    if (group.settledOnce.current) return;
    group.settledOnce.current = true;
    if (!disagrees || !group.panel) return;
    if (group.state.open) group.panel.resize(group.openSize);
    else group.panel.collapse();
  };

  const wide = props.viewport === "wide";

  const center = (
    <ResizablePanelGroup
      orientation="vertical"
      id="layout-vertical"
      defaultLayout={props.vertical}
      onLayoutChanged={(layout, meta) =>
        settle(
          {
            panel: consoleRef.current,
            state: props.consoleState,
            openSize: consoleOpenSize.current,
            settledOnce: consoleSettled,
            save: props.onVerticalLayout,
          },
          layout,
          meta
        )
      }
    >
      <ResizablePanel id="stage" className="flex min-h-0 flex-col">
        {props.stage}
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        id="console"
        panelRef={consoleRef}
        collapsible
        collapsedSize={PANEL_SIZES.console.folded}
        defaultSize={
          props.consoleState.open
            ? PANEL_SIZES.console.default
            : PANEL_SIZES.console.folded
        }
        minSize={PANEL_SIZES.console.min}
        groupResizeBehavior="preserve-pixel-size"
        className="flex min-h-0 flex-col"
        onResize={(size) => {
          if (
            foldedOf(consoleRef.current) === false &&
            size.inPixels > PANEL_SIZES.console.folded
          ) {
            consoleOpenSize.current = size.inPixels;
          }
        }}
      >
        {props.console}
      </ResizablePanel>
    </ResizablePanelGroup>
  );

  return (
    <SidebarProvider
      open={props.leftOpen}
      onOpenChange={props.onLeftOpenChange}
      style={{ ...SIDEBAR_STYLE, padding: `0 ${GAP} ${GAP}` }}
      className="relative min-h-0 flex-1"
    >
      {/* The stock Sidebar is fixed at the window's full height; Flow's
          header keeps the top, so it sits in the area under it instead, inset
          by the gutter. The left panel draws its own rounded border, so the
          container's edge line and fill are dropped. */}
      <Sidebar
        collapsible="icon"
        className="absolute inset-y-0 h-auto group-data-[side=left]:border-r-0 [&>[data-slot=sidebar-inner]]:bg-transparent"
        style={{ left: GAP, bottom: GAP }}
      >
        <div className="contents" style={props.sheetFont}>
          <LeftSlot render={props.left} />
        </div>
      </Sidebar>
      <LeftSheetOpener
        onChange={props.onLeftSheetChange}
        closeOn={props.closeLeftSheetOn}
      />
      <SidebarInset className="relative min-h-0 min-w-0 md:ml-2">
        {/* One tree at every width, so a rotate across
            `LAYOUT_BREAKPOINTS.compact` does not remount the stage, Monaco or
            the console's terminal. Below it the group holds only the centre,
            so it neither takes nor saves the horizontal layout: crossing a
            breakpoint writes nothing. */}
        <ResizablePanelGroup
          orientation="horizontal"
          id="layout-horizontal"
          defaultLayout={wide ? props.horizontal : undefined}
          onLayoutChanged={
            wide
              ? (layout, meta) =>
                  settle(
                    {
                      panel: assistantRef.current,
                      state: props.assistantState,
                      openSize: assistantOpenSize.current,
                      settledOnce: assistantSettled,
                      save: props.onHorizontalLayout,
                    },
                    layout,
                    meta
                  )
              : undefined
          }
        >
          <ResizablePanel
            id="center"
            minSize={PANEL_SIZES.centerMin}
            className="flex min-w-0 flex-col"
          >
            {center}
          </ResizablePanel>
          {wide && <ResizableHandle className="w-2 bg-transparent" />}
          {wide && (
            <ResizablePanel
              id="assistant"
              panelRef={assistantRef}
              collapsible
              collapsedSize={PANEL_SIZES.assistant.folded}
              defaultSize={
                props.assistantState.open
                  ? PANEL_SIZES.assistant.default
                  : PANEL_SIZES.assistant.folded
              }
              minSize={PANEL_SIZES.assistant.min}
              maxSize={PANEL_SIZES.assistant.max}
              groupResizeBehavior="preserve-pixel-size"
              className="flex min-w-0 flex-col"
              onResize={(size) => {
                if (
                  foldedOf(assistantRef.current) === false &&
                  size.inPixels > PANEL_SIZES.assistant.folded
                ) {
                  assistantOpenSize.current = size.inPixels;
                }
              }}
            >
              {props.assistant}
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
        {props.viewport !== "wide" && (
          <>
            {/* Under the settings panel (fixed, z-2) when it opens over it */}
            <div className="absolute top-1 right-0 z-1">
              {props.assistantOpener}
            </div>
            <Sheet
              open={props.assistantState.open}
              onOpenChange={props.assistantState.onOpenChange}
            >
              <SheetContent
                side="right"
                showCloseButton={false}
                aria-describedby={undefined}
                className={cn("p-0", SHEET_WIDTH[props.viewport])}
                style={props.sheetFont}
              >
                <SheetTitle className="sr-only">Assistant</SheetTitle>
                {props.assistant}
              </SheetContent>
            </Sheet>
          </>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
};

export default BaseLayoutShell;
