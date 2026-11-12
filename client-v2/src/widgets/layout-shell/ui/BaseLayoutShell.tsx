import type { CSSProperties, MutableRefObject, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { usePanelRef } from "react-resizable-panels";

import type { Viewport } from "@/shared/lib/hooks/use-viewport";
import { RAIL_WIDTH } from "@/shared/lib/hooks/use-viewport";
import { KeybindsActive } from "@/shared/lib/keybinds-active";
import { createLogger } from "@/shared/lib/logger";
import { Outlet, OutletContent, useOutletNode } from "@/shared/lib/outlet";
import { UndockPin } from "@/shared/lib/tree-dock";
import { cn } from "@/shared/lib/utils";
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
import { BOTTOM_BAR_PX } from "@/views/flow/tokens";

import type {
  HorizontalLayout,
  PanelLayout,
  VerticalLayout,
  WorkLayout,
} from "../model/layout-state";
import { homeOf, isWorkInFrame, screenOf } from "../model/screen";
import type { PhonePagerState } from "./BasePhonePager";
import BasePhonePager from "./BasePhonePager";
import BaseTutorialPhone from "./BaseTutorialPhone";

const FILES = { default: 240, min: 192, folded: 0 } as const;
/** The stage over the console, beside the files column inside `work` */
const STAGE = { min: 240 } as const;
/** The handles between the columns: the stock 1 px line */
const HANDLE_PX = 1;

/**
 * Sizes in px; the design system gives the navigation's in rem
 * (`SIDEBAR_STYLE`, which owns that width). The files column has no maximum
 * of its own: what stops it growing is the stage's `stage.min` beside it.
 * `work.min` is an open files column at its minimum, the handle and the stage
 * at its minimum, so the work area never takes less than both need: on a
 * narrow window with every column open the assistant gives way instead.
 * The console folds to its bar, which `BaseConsoleDrawer` draws at
 * `BOTTOM_BAR_PX`.
 */
export const PANEL_SIZES = {
  assistant: { default: 368, min: 280, max: 560, folded: 0 },
  files: FILES,
  stage: STAGE,
  console: { default: 256, min: 120, folded: BOTTOM_BAR_PX },
  /**
   * The console in a tutorial's frame: the prototype's terminal drawer,
   * 240 open and never over 60 % of the workspace's height
   */
  tutorialConsole: { default: 240, max: "60%" },
  handle: HANDLE_PX,
  work: { min: FILES.min + HANDLE_PX + STAGE.min },
} as const;

/**
 * The navigation's open and rail widths, as the design system's migration
 * map has them; the one place they are set.
 */
const SIDEBAR_STYLE = {
  "--sidebar-width": "14.5rem",
  "--sidebar-width-icon": RAIL_WIDTH,
} as CSSProperties;

/**
 * Same variants as `shared/ui/sheet`'s own `data-[side=right]:w-3/4
 * data-[side=right]:sm:max-w-sm`: an unprefixed width loses to them. It
 * keeps 21.75 rem (348 px): the panel's 368 px default is the prototype's
 * width at 1440, and the tablet is unchanged by 5.25. Home's assistant Sheet,
 * at every width, keeps the same.
 */
const ASSISTANT_SHEET_WIDTH =
  "data-[side=right]:w-[21.75rem] data-[side=right]:sm:max-w-[21.75rem]";

export interface PanelState {
  open: boolean;
  /** Called for the user's own change only: a drag, a key, a tap */
  onOpenChange: (open: boolean) => void;
}

/**
 * What the navigation is handed. A union on `isMobile`, so the phone's menu
 * page, which has no rail, cannot be handed `collapsed: true`. From
 * `LAYOUT_BREAKPOINTS.phone` up the stock Sidebar is a column or its rail;
 * below it the pager gives the navigation a page, whose `toggle` goes back to
 * Work.
 */
export type NavStock =
  | {
      /** The pager's menu page, below `LAYOUT_BREAKPOINTS.phone` */
      isMobile: true;
      /** Goes back to Work */
      toggle: () => void;
      collapsed: false;
    }
  | {
      isMobile: false;
      /** Folds or unfolds the rail, from `LAYOUT_BREAKPOINTS.phone` up */
      toggle: () => void;
      /** Folded to its rail */
      collapsed: boolean;
    };

/**
 * What the files column is handed: in the work group there is no Sheet and
 * so no toggle to hand it. On a phone the pager's own Files Sheet holds it,
 * and the toggle closes that Sheet.
 */
export type FilesStock =
  | { isMobile: true; toggle: () => void }
  | { isMobile: false };

/**
 * What the assistant is handed to widen itself: the panel sized to
 * `PANEL_SIZES.assistant.max` and back, for the visit. Never saved: the
 * stored layout takes only the user's drags. `setWide` does nothing below
 * `LAYOUT_BREAKPOINTS.compact` (a Sheet, or a page of the phone pager),
 * while Home shows, or while the panel is folded; a drag of the panel's
 * edge ends `wide`.
 */
export interface AssistantWide {
  wide: boolean;
  /**
   * Widens or narrows the panel; returns whether it changed it, so a caller
   * measures only what happened (`layout_assistant_widened`)
   */
  setWide: (wide: boolean) => boolean;
  /** Whether `setWide` can do anything now, so Widen is offered only then */
  canWiden: boolean;
  /**
   * The assistant is the right Sheet: under Home at every width, and between
   * `LAYOUT_BREAKPOINTS.phone` and `LAYOUT_BREAKPOINTS.compact`. Not on the
   * phone's pager, whose assistant is a page, nor in the wide frame's column
   * at the left. The head's Collapse points right only in the Sheet
   */
  inSheet: boolean;
}

/**
 * The navigation in a tutorial: on its rail, open over the chat under a
 * scrim, or pinned open beside it. The frame's fold rules
 * (`widgets/tutorial-frame`) decide it, in place of the saved layout.
 */
export type TutorialNavFold = "rail" | "overlay" | "pinned";

export interface TutorialNavState {
  fold: TutorialNavFold;
  /** The stock toggle or ⌘B asked it open or folded */
  onOpenChange: (open: boolean) => void;
  /** A pick in it, the scrim or Escape closed the overlay */
  onClose: () => void;
}

/**
 * A tutorial with a definition (`tutorial-flow-v2`, task 2.1): the work area
 * becomes the chat column, then the files column beside the stage over the
 * console. In it the stage holds the tutorial's workspace (task 2.2: its
 * head, tree and line states) and the console is its drawer, at its own
 * height and never saved as the split. The stage bar, the stage tabs and the
 * assistant are not drawn;
 * the stage and the console are the same outlets, so nothing remounts on the
 * way in or out. Only on the work screen of a wide window; narrower windows
 * draw `phone` on the work screen when it is given, and under a page the
 * pager or the compact frame.
 */
export interface TutorialFrameSlot {
  /** The chat column, which holds its own width */
  chat: ReactNode;
  nav: TutorialNavState;
  /** Drawn over the frame, from its top left: the first fold's hint */
  overNav?: ReactNode;
  /** The tutorial below the frame's width (`BaseTutorialPhone`) */
  phone?: TutorialPhoneSlot;
}

/** Which of a tutorial's two spaces shows below the frame's width */
export type TutorialSpace = "chat" | "code";

/**
 * A tutorial below the frame's width (`tutorial-flow-v2`, task 5.1): a head
 * over two spaces side by side, Chat and Code. Code holds the stage and the
 * console outlets, so a rotation across the frame's width moves them without
 * remounting the editor or the terminal.
 */
export interface TutorialPhoneSlot {
  head: ReactNode;
  /** Chat's body, the same feed the frame's chat column draws */
  chat: ReactNode;
  space: TutorialSpace;
  /** A swipe asked for the other space; the owner decides and sets `space` */
  onSpace: (space: TutorialSpace, via: "swipe") => void;
}

export interface BaseLayoutShellProps {
  viewport: Viewport;
  /** The stock Sidebar's open state, from `LAYOUT_BREAKPOINTS.phone` up */
  navOpen: boolean;
  /** The stock Sidebar's toggle or ⌘B changed `navOpen` */
  onNavOpenChange: (open: boolean) => void;
  /**
   * The assistant's open state, which follows the viewport: the panel on a
   * wide screen (`onOpenChange` is a drag folding or unfolding it), the Sheet
   * below `LAYOUT_BREAKPOINTS.compact`
   */
  assistantState: PanelState;
  /**
   * The files column, from `LAYOUT_BREAKPOINTS.phone` up: the project tree
   * docked and shown. Folded or unfolded by dragging
   */
  filesState: PanelState;
  /**
   * "Undock the files", drawn at the files column's top right when given:
   * the tree goes back to its dropdown under the editor head
   */
  onUndockFiles?: () => void;
  /**
   * The code area's width in px as it changes: the files column and the stage
   * together, whether the column shows or not, measured with a ResizeObserver
   */
  onCodeWidth?: (width: number) => void;
  /** The console is folded or unfolded by dragging */
  consoleState: PanelState;
  horizontal?: HorizontalLayout;
  work?: WorkLayout;
  vertical?: VerticalLayout;
  onHorizontalLayout: (layout: PanelLayout) => void;
  onWorkLayout: (layout: PanelLayout) => void;
  onVerticalLayout: (layout: PanelLayout) => void;
  /**
   * Renders the navigation, inside the stock Sidebar; on a phone, on the
   * pager's menu page. Across `LAYOUT_BREAKPOINTS.phone` it remounts: only the
   * stage and the console keep their nodes.
   */
  nav: (stock: NavStock) => ReactNode;
  /**
   * Renders the files column: in the work group from
   * `LAYOUT_BREAKPOINTS.phone`, where there is no left Sheet (HOO-2208).
   * Below it the pager shows it in its own Sheet.
   */
  files: (stock: FilesStock) => ReactNode;
  /**
   * The 44 px bar at the top of the work area, over the files column and the
   * stage (`BaseStageBar`); not on a phone, whose pager has its own bar
   */
  stageBar: ReactNode;
  /**
   * The stage tabs, in a row under `stageBar` across the files column and the
   * stage; on a phone, in the bar of the preview page
   */
  stageTabs: ReactNode;
  /**
   * The editor head (`BaseEditorHead`), under `stageTabs` across the files
   * column and the stage, outside their group so opening the column moves
   * nothing in it. Not on a phone, and not under Home, where no work shows.
   */
  workHead?: ReactNode;
  stage: ReactNode;
  console: ReactNode;
  /** Renders the assistant, in its panel, its Sheet or the pager's page */
  assistant: (wide: AssistantWide) => ReactNode;
  /**
   * The font a Sheet's content is set in. Sheets portal outside the app
   * wrapper that sets it, so they would fall back to the browser's.
   */
  sheetFont?: CSSProperties;
  /**
   * Below `LAYOUT_BREAKPOINTS.phone`: the pager's state. The slots and the
   * outlets' nodes are the shell's own.
   */
  phone: PhonePagerState;
  /** The phone's status chip, in the work page's bar */
  phoneStatus?: ReactNode;
  /**
   * Home, in place of the assistant and the work; given means Home shows.
   * The frame keeps the navigation and shows `stageBar` over `content` where
   * the columns go, the pager shows it on its work page with no preview page.
   * The stage tabs are not rendered. The stage and the console are not
   * either, so the editor never mounts under Home, unless `keepWork` keeps
   * them mounted off the page.
   * `content` is null while the start is still being decided.
   *
   * The assistant's Sheet, otherwise only in the frame below
   * `LAYOUT_BREAKPOINTS.compact`, is the assistant at every width while Home
   * shows, opened by Home's composer or the bar; `assistant` is its state.
   */
  home?: { content: ReactNode; assistant: PanelState };
  /**
   * While Home shows, keep the stage and the console mounted in their
   * outlets, which Home leaves off the page: an open project's editor and
   * terminal then come back as they were, undo history and scrollback
   * included. Only while the work can be drawn: on `/` with no project
   * open there is nothing to keep, and the editor would throw.
   */
  keepWork?: boolean;
  /**
   * A page (Tutorials, Programs) under its own `bar`. Under Home it takes
   * Home's place. Over the work it covers the assistant and the work columns
   * while they stay mounted and `inert` under it, so closing the page shows
   * them as they were. On a phone it is the pager's work page.
   */
  cover?: { bar: ReactNode; content: ReactNode };
  /** A tutorial's frame, given while a tutorial with a definition is open */
  tutorial?: TutorialFrameSlot;
}

/** Where an Escape belongs to something open over the navigation */
const OWNS_ESCAPE =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** What a click in the navigation picks, and so closes its overlay with */
const PICK = 'a[href], button, [role="menuitem"], [role="link"]';
/**
 * What opens something in place rather than going somewhere: a menu's
 * trigger, a group that unfolds. Folding the overlay on it would take away
 * the anchor of what it just opened.
 */
const OPENS_IN_PLACE = "[aria-haspopup], [aria-expanded]";

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

/**
 * While the navigation is an overlay in a tutorial, Escape closes it, and
 * folding it back to the rail gives focus back to where it was when the
 * overlay opened, as a dialog would. Pinning it keeps focus where it is.
 */
const useOverlayFocus = (
  fold: TutorialNavFold | undefined,
  // eslint-disable-next-line layers/curry-order -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
  onClose?: () => void
) => {
  const overlay = fold === "overlay";
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Read by the cleanup, which runs once the next fold has rendered
  const foldRef = useRef(fold);
  foldRef.current = fold;
  useEffect(() => {
    if (!overlay) return;
    const before =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
          null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A menu or dialog opened from the navigation takes its own Escape
      // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(OWNS_ESCAPE)) return;
      e.preventDefault();
      closeRef.current?.();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Pinned, the navigation stays, and so does focus on the pin
      if (foldRef.current === "pinned") return;
      // Only when focus is lost or left in the navigation: a pick that moved
      // it somewhere on purpose keeps it there
      const now = document.activeElement;
      const lost =
        now === null ||
        now === document.body ||
        now.closest('[data-slot="sidebar"]') !== null;
      if (before?.isConnected && lost) before.focus();
    };
  }, [overlay]);
};

/** The assistant as a right Sheet, titled "Assistant" for its dialog */
const AssistantSheet = ({
  state,
  sheetFont,
  children,
}: {
  state: PanelState;
  sheetFont?: CSSProperties;
  children: ReactNode;
}) => (
  <Sheet open={state.open} onOpenChange={state.onOpenChange}>
    <SheetContent
      side="right"
      showCloseButton={false}
      aria-describedby={undefined}
      className={cn("p-0", ASSISTANT_SHEET_WIDTH)}
      style={sheetFont}
    >
      <SheetTitle className="sr-only">Assistant</SheetTitle>
      {children}
    </SheetContent>
  </Sheet>
);

/** The stock Sidebar's content: the navigation, as a column or its rail */
const NavSlot = ({ nav }: { nav: BaseLayoutShellProps["nav"] }) => {
  const { toggleSidebar, open } = useSidebar();
  return (
    <>{nav({ isMobile: false, toggle: toggleSidebar, collapsed: !open })}</>
  );
};

/**
 * The four-column frame: the navigation as the stock Sidebar, then the
 * assistant on a wide screen (a Sheet below `LAYOUT_BREAKPOINTS.compact`), then
 * the work area: the stage bar, the stage tabs and the editor head over the
 * files column and the stage, the stage over the console. Below `LAYOUT_BREAKPOINTS.phone` the frame gives way
 * to `BasePhonePager`; the stage and the console are outlets, so their nodes
 * move between the two without remounting. Lays out what it is given; owns
 * the outlets' nodes and, of layout state, only the assistant widened for
 * the visit (`AssistantWide`), never saved.
 */
const BaseLayoutShell = (props: BaseLayoutShellProps) => {
  const [foldedOf] = useState(createFoldedOf);
  // Rendered once, here, and placed by the frame or the pager: crossing
  // `LAYOUT_BREAKPOINTS.phone` must not remount the stage's editor (upstream's `Primary`; it goes blank when
  // remounted) or the terminal (it loses its session)
  const stageNode = useOutletNode("flex min-h-0 flex-1 flex-col");
  const consoleNode = useOutletNode("flex min-h-0 flex-1 flex-col");
  const assistantRef = usePanelRef();
  const filesRef = usePanelRef();
  const consoleRef = usePanelRef();
  // The size each panel last had open, in px. Opening goes through
  // `resize(openSize)`, not `expand()`: `expand()` restores a size the panel
  // had before it folded, and a panel that mounted folded never had one, so it
  // would open at its minimum instead of its default.
  const assistantOpenSize = useRef<number>(PANEL_SIZES.assistant.default);
  const filesOpenSize = useRef<number>(PANEL_SIZES.files.default);
  const consoleOpenSize = useRef<number>(PANEL_SIZES.console.default);

  // Whether each group has settled its first layout on its own, which a
  // restore can leave disagreeing with the panel's flag
  const assistantSettled = useRef(false);
  const filesSettled = useRef(false);
  const consoleSettled = useRef(false);

  const screen = screenOf(props.home, props.cover);
  // Under Home, and a page over Home, the work is out of the frame; it stays
  // mounted, off the page, only with `keepWork`
  const workInFrame = isWorkInFrame(screen);
  const workMounted = workInFrame || props.keepWork === true;
  const home = homeOf(screen);
  // The tutorial's layout holds under a page over the work too, which keeps
  // the work laid out as it was; its navigation holds on the work screen
  // only. It is wide-only: below wide the work screen takes `tutorial.phone`
  // (`tutorialPhone`), and a page over it keeps the pager or compact frame.
  const tutorialLayout =
    props.tutorial !== undefined && workInFrame && props.viewport === "wide";
  const tutorialNav =
    tutorialLayout && screen.kind === "work" ? props.tutorial?.nav : undefined;
  // Below the frame's width, a tutorial on the work screen draws its own
  // layout in place of the pager or the compact frame. Under a page it does
  // not: the page needs the pager's or the frame's bars to be left.
  const tutorialPhone =
    props.viewport !== "wide" && screen.kind === "work"
      ? props.tutorial?.phone
      : undefined;
  const overlay = tutorialNav?.fold === "overlay";
  useOverlayFocus(tutorialNav?.fold, tutorialNav?.onClose);

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

  // Widened for the visit (`AssistantWide`): the open size the panel had when
  // it was widened, `null` while it is not wide
  const [wideFrom, setWideFrom] = useState<number | null>(null);
  /**
   * Folded, below `LAYOUT_BREAKPOINTS.compact`, or under Home, where the
   * assistant is its Sheet at every width: there is no panel to widen
   */
  const wideEnds =
    !workInFrame || props.viewport !== "wide" || !props.assistantState.open;
  const setWide = (next: boolean) => {
    if (wideEnds) return false;
    const panel = assistantRef.current;
    if (!panel || next === (wideFrom !== null)) return false;
    if (next) {
      setWideFrom(assistantOpenSize.current);
      // A resize the product makes reaches `onLayoutChanged` with
      // `isUserInteraction` false, so `settle` saves nothing for it
      panel.resize(PANEL_SIZES.assistant.max);
      return true;
    }
    panel.resize(wideFrom ?? PANEL_SIZES.assistant.default);
    setWideFrom(null);
    return true;
  };
  // Folding, or leaving for the Sheet or the pager, ends `wide`; the panel
  // reopens at the size it had before it was widened, not at the maximum
  // `onResize` saw. `wideFrom` cannot become set while `wideEnds` holds
  // (`setWide` refuses), so running on its change only returns early.
  useEffect(() => {
    if (!wideEnds) return;
    if (wideFrom !== null) assistantOpenSize.current = wideFrom;
    setWideFrom(null);
  }, [wideEnds, wideFrom]);
  const assistant = props.assistant({
    wide: wideFrom !== null,
    setWide,
    canWiden: !wideEnds,
    inSheet: home !== undefined || props.viewport === "compact",
  });

  // Hidden, the files column is not in the group at all (design.md, "Frame
  // chrome (5.25)"): a collapsible panel at 0 px stays in the library's
  // layout, which snapped it open to its minimum when a drag of the
  // assistant's edge reflowed the work area. Opening mounts it at the width it
  // last had.
  // A tutorial's frame has no files column, whatever was saved: the feed's
  // step head carries the steps and the workspace head the tree
  // (`tutorial-frame-2nov`). Nothing there folds or saves it.
  // A fresh object each render; read only by `.open` in the effects below
  const filesState: PanelState = tutorialLayout
    ? { open: false, onOpenChange: () => undefined }
    : props.filesState;
  const filesShown = filesState.open;
  // A drag that folds the open column is the one fold left to the library
  useEffect(() => {
    if (!filesShown) return;
    const panel = filesRef.current;
    const folded = foldedOf(panel);
    if (!panel || folded === undefined) return;
    if (folded === !filesState.open) return;
    if (filesState.open) panel.resize(filesOpenSize.current);
    else panel.collapse();
    // The width is read, not a trigger, as the assistant's viewport above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesState.open, filesRef, foldedOf]);
  useEffect(() => {
    // The column mounts again when shown, or on the way back from the Sheet,
    // and settles again
    if (!filesShown) filesSettled.current = false;
  }, [filesShown]);
  // Entering or leaving a tutorial's frame mounts the files column and the
  // stage over the console again, in the other branch, and they settle again
  const tutorialSeen = useRef(tutorialLayout);
  useEffect(() => {
    if (tutorialSeen.current === tutorialLayout) return;
    tutorialSeen.current = tutorialLayout;
    filesSettled.current = false;
    consoleSettled.current = false;
  }, [tutorialLayout]);
  // The drawer reopens at its own height in the frame, the console at its
  // own outside it; a drag inside either keeps its own from then on
  useEffect(() => {
    consoleOpenSize.current = tutorialLayout
      ? PANEL_SIZES.tutorialConsole.default
      : PANEL_SIZES.console.default;
  }, [tutorialLayout]);

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

  // The code area, measured: the work group spans the files column and the
  // stage, so showing or hiding the column leaves its width as it was
  const [codeArea, setCodeArea] = useState<HTMLDivElement | null>(null);
  const onCodeWidth = useRef(props.onCodeWidth);
  onCodeWidth.current = props.onCodeWidth;
  useEffect(() => {
    if (!codeArea) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) onCodeWidth.current?.(entry.contentRect.width);
    });
    ro.observe(codeArea);
    return () => ro.disconnect();
  }, [codeArea]);

  // What stands where the columns go when the work is not mounted: a page in
  // Home's place under its own bar, else Home under the column bar
  const inPlace =
    screen.kind === "page"
      ? { bar: screen.cover.bar, content: screen.cover.content }
      : { bar: props.stageBar, content: home?.content };

  const consoleDefault = tutorialLayout
    ? PANEL_SIZES.tutorialConsole.default
    : PANEL_SIZES.console.default;
  const center = (
    <ResizablePanelGroup
      orientation="vertical"
      id="layout-vertical"
      // The frame's drawer has its own height, never the saved split's
      defaultLayout={tutorialLayout ? undefined : props.vertical}
      onLayoutChanged={(layout, meta) =>
        settle(
          {
            panel: consoleRef.current,
            state: props.consoleState,
            openSize: consoleOpenSize.current,
            settledOnce: consoleSettled,
            // A drag of the frame's drawer is the visit's, not the saved split
            save: tutorialLayout ? () => undefined : props.onVerticalLayout,
          },
          layout,
          meta
        )
      }
    >
      <ResizablePanel id="stage" className="flex min-h-0 flex-col">
        <Outlet node={stageNode} className="flex min-h-0 flex-1 flex-col" />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        id="console"
        panelRef={consoleRef}
        collapsible
        collapsedSize={PANEL_SIZES.console.folded}
        defaultSize={
          props.consoleState.open ? consoleDefault : PANEL_SIZES.console.folded
        }
        minSize={PANEL_SIZES.console.min}
        maxSize={tutorialLayout ? PANEL_SIZES.tutorialConsole.max : undefined}
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
        <Outlet node={consoleNode} className="flex min-h-0 flex-1 flex-col" />
      </ResizablePanel>
    </ResizablePanelGroup>
  );

  // The files column beside the stage over the console, under the stage bar;
  // in a tutorial's frame the stage alone, beside the chat
  const workGroup = (
    <ResizablePanelGroup
      orientation="horizontal"
      id="layout-work"
      elementRef={setCodeArea}
      className="h-auto min-h-0 flex-1"
      defaultLayout={filesShown ? props.work : undefined}
      onLayoutChanged={
        !filesShown
          ? undefined
          : (layout, meta) =>
              settle(
                {
                  panel: filesRef.current,
                  state: filesState,
                  openSize: filesOpenSize.current,
                  settledOnce: filesSettled,
                  save: props.onWorkLayout,
                },
                layout,
                meta
              )
      }
    >
      {filesShown && (
        <ResizablePanel
          id="files"
          panelRef={filesRef}
          collapsible
          collapsedSize={PANEL_SIZES.files.folded}
          defaultSize={filesOpenSize.current}
          minSize={PANEL_SIZES.files.min}
          groupResizeBehavior="preserve-pixel-size"
          className="flex min-w-0 flex-col"
          onResize={(size) => {
            if (
              foldedOf(filesRef.current) === false &&
              size.inPixels > PANEL_SIZES.files.folded
            ) {
              filesOpenSize.current = size.inPixels;
            }
          }}
        >
          {/* The unpin sits over the tree's top right, as in a tutorial */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {props.files({ isMobile: false })}
            {props.onUndockFiles && (
              <UndockPin onUndock={props.onUndockFiles} />
            )}
          </div>
        </ResizablePanel>
      )}
      {filesShown && <ResizableHandle />}
      <ResizablePanel
        id="center"
        minSize={PANEL_SIZES.stage.min}
        className="flex min-w-0 flex-col"
      >
        {center}
      </ResizablePanel>
    </ResizablePanelGroup>
  );

  return (
    <>
      {/* Under Home only with `keepWork`, and then off the page: Home places
      no outlet, as the pager places none on a page it does not show */}
      {/* Off screen (under Home, kept, or under a page, inert), the work's own
      keys (a tab's close, the console's) would act
      on what is not seen */}
      <KeybindsActive.Provider value={screen.kind === "work"}>
        {workMounted && (
          <OutletContent node={stageNode}>{props.stage}</OutletContent>
        )}
        {workMounted && (
          <OutletContent node={consoleNode}>{props.console}</OutletContent>
        )}
      </KeybindsActive.Provider>
      {home && (
        <AssistantSheet state={home.assistant} sheetFont={props.sheetFont}>
          {assistant}
        </AssistantSheet>
      )}
      {tutorialPhone && (
        <SidebarProvider
          open={false}
          style={SIDEBAR_STYLE}
          className="relative min-h-0 flex-1"
        >
          {/* In a provider for the same reason as the pager: what the stage
          holds may read the stock Sidebar's context */}
          <BaseTutorialPhone
            phone={tutorialPhone}
            stageNode={stageNode}
            consoleNode={consoleNode}
            consoleOpen={props.consoleState.open}
            tablet={props.viewport === "compact"}
          />
        </SidebarProvider>
      )}
      {!tutorialPhone &&
        (props.viewport === "phone" ? (
          <SidebarProvider
            open={false}
            style={SIDEBAR_STYLE}
            className="relative min-h-0 flex-1"
          >
            {/* The navigation and the files column are written against the stock
          Sidebar's context (`useSidebar`), so the pager sits in a provider too,
          though it never shows the Sidebar itself */}
            <BasePhonePager
              {...props.phone}
              menu={props.nav({
                isMobile: true,
                toggle: () => props.phone.onGo("work"),
                collapsed: false,
              })}
              files={
                !workInFrame
                  ? null
                  : props.files({
                      isMobile: true,
                      toggle: () => props.phone.onFilesOpenChange(false),
                    })
              }
              home={props.home && { content: props.home.content }}
              cover={props.cover && { content: props.cover.content }}
              assistant={assistant}
              stageBar={props.stageTabs}
              stageNode={stageNode}
              consoleNode={consoleNode}
              sheetFont={props.sheetFont}
              status={props.phoneStatus}
            />
          </SidebarProvider>
        ) : (
          <SidebarProvider
            open={tutorialNav ? tutorialNav.fold !== "rail" : props.navOpen}
            onOpenChange={tutorialNav?.onOpenChange ?? props.onNavOpenChange}
            style={SIDEBAR_STYLE}
            data-nav-overlay={overlay || undefined}
            // Over the chat, the column keeps only the rail's width in the row,
            // so the chat stays where it was under the open navigation
            className={cn(
              "relative min-h-0 flex-1",
              overlay &&
                "[&_[data-slot=sidebar-gap]]:w-(--sidebar-width-icon)! [&_[data-slot=sidebar-container]]:z-30"
            )}
          >
            {tutorialNav && props.tutorial?.overNav}
            {/* The stock Sidebar's container is fixed at the window's full height.
          Flow draws the sync banner above the provider, so the Sidebar sits
          inside the provider instead, where the banner pushes it down rather
          than being covered by it. The frame is flush (design.md, "Frame
          chrome (5.25)"): the container keeps its right line, the columns'
          divider. Its fill is the page's colour, so it covers the window's
          pattern as the prototype's navigation does. */}
            <Sidebar
              collapsible="icon"
              className="absolute inset-y-0 left-0 h-auto border-border [&>[data-slot=sidebar-inner]]:bg-background"
              // A pick in the overlay closes it. Bubble phase, so the pick's
              // own click (the pin's) runs before the close unmounts it. Only
              // a pick in the column itself: React bubbles a click in a menu or
              // dialog the navigation opened, portaled elsewhere, through here
              onClick={
                overlay
                  ? (e) => {
                      const target = e.target;
                      if (!(target instanceof Element)) return;
                      if (!e.currentTarget.contains(target)) return;
                      const pick = target.closest(PICK);
                      if (pick && !pick.matches(OPENS_IN_PLACE)) {
                        tutorialNav?.onClose();
                      }
                    }
                  : undefined
              }
            >
              <div className="contents" style={props.sheetFont}>
                <NavSlot nav={props.nav} />
              </div>
            </Sidebar>
            <SidebarInset className="relative min-h-0 min-w-0 bg-transparent">
              {!workInFrame ? (
                // The column bar over Home (or over a page in Home's place) as
                // over the work: no stage tabs, since no stage shows
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {inPlace.bar}
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
                    {inPlace.content}
                  </div>
                </div>
              ) : (
                <>
                  {/* Under a page the work stays laid out and mounted, out of
                reach: `inert` keeps focus, clicks and the accessibility tree
                off it */}
                  <div className="contents" inert={screen.kind === "page"}>
                    {tutorialLayout ? (
                      <div
                        data-testid="tutorial-frame"
                        className="flex min-h-0 min-w-0 flex-1"
                      >
                        {props.tutorial?.chat}
                        {/* The stage alone: the frame has no files column, the
                      workspace head holds the tree */}
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                          {workGroup}
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Between `LAYOUT_BREAKPOINTS.compact` and wide the tree is the
            same, so a rotate across it does not remount the stage, Monaco or
            the console's terminal; across `LAYOUT_BREAKPOINTS.phone` the
            frame swaps for the pager and they survive as outlets. Below
            `LAYOUT_BREAKPOINTS.compact` the group holds only the work
            area, so it neither takes nor saves the horizontal layout:
            crossing a breakpoint writes nothing. */}
                        <ResizablePanelGroup
                          orientation="horizontal"
                          id="layout-horizontal"
                          defaultLayout={wide ? props.horizontal : undefined}
                          onLayoutChanged={
                            wide
                              ? (layout, meta) => {
                                  // A drag of the panel's edge takes over from Widen
                                  // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
                                  if (meta.isUserInteraction) setWideFrom(null);
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
                                  );
                                }
                              : undefined
                          }
                        >
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
                              {assistant}
                            </ResizablePanel>
                          )}
                          {/* Hidden, the assistant takes no width and its handle would double
              the navigation's line; it stays a drag target, only unseen */}
                          {wide && (
                            <ResizableHandle
                              className={
                                props.assistantState.open
                                  ? undefined
                                  : "bg-transparent"
                              }
                            />
                          )}
                          <ResizablePanel
                            id="work"
                            minSize={PANEL_SIZES.work.min}
                            // Over the stage tabs the bar and the tabs read as
                            // one head, so the bar drops its line there; with
                            // no stage tabs (Home, a page, a tutorial before
                            // Start) it keeps it over what comes next
                            className={cn(
                              "flex min-w-0 flex-col",
                              props.stageTabs &&
                                "[&>[data-slot=stage-bar]]:border-b-transparent"
                            )}
                          >
                            {/* Over the files column and the stage both, as the prototype
                draws them: the column bar, the stage tabs, then the editor head */}
                            {props.stageBar}
                            {props.stageTabs}
                            {props.workHead}
                            {/* Hidden, the group holds only the
                stage and, like the horizontal group below `compact`, neither
                takes nor saves its layout */}
                            {workGroup}
                          </ResizablePanel>
                        </ResizablePanelGroup>
                        {props.viewport !== "wide" && (
                          <AssistantSheet
                            state={props.assistantState}
                            sheetFont={props.sheetFont}
                          >
                            {assistant}
                          </AssistantSheet>
                        )}
                      </>
                    )}
                  </div>
                  {overlay && (
                    <div
                      data-testid="tutorial-nav-scrim"
                      aria-hidden
                      className="absolute inset-0 z-20 bg-black/40"
                      onClick={tutorialNav?.onClose}
                    />
                  )}
                  {screen.kind === "page" && (
                    <div
                      data-testid="layout-cover"
                      className="absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col bg-background"
                    >
                      {screen.cover.bar}
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
                        {screen.cover.content}
                      </div>
                    </div>
                  )}
                </>
              )}
            </SidebarInset>
          </SidebarProvider>
        ))}
    </>
  );
};

export default BaseLayoutShell;
