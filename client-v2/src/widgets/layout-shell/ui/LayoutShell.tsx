import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "styled-components";

import { useExplorer, useKeybind, useRenderOnChange } from "@/hooks";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { PgCommand, PgCommon, PgExplorer, PgView } from "@/utils";
import { PgFlow } from "@/views/flow/state/stage";
import type { StageStatus } from "@/views/flow/state/stage";
import { PgAssistant } from "@/views/sidebar/assistant/store";
import { pageForStage, stageForPage, stagePageOf } from "../model/phone-pages";
import { CONSOLE_KEY } from "../model/keys";
import { homeOf, isCovered, screenOf } from "../model/screen";
import type {
  PageSource,
  PhonePage,
  PreviewStage,
  WorkView,
  WorkViewSource,
} from "../model/phone-pages";
import { layoutTelemetry } from "../model/telemetry";
import type { ToggleSource } from "../model/telemetry";
import { useLayoutState } from "../model/use-layout-state";
import BaseLayoutShell from "./BaseLayoutShell";
import BaseStageBar from "./BaseStageBar";
import type { AssistantWide } from "./BaseLayoutShell";

export interface LayoutShellProps {
  /**
   * The navigation. `collapsed` is never true on a phone's menu page, which
   * has no rail; `toggle` folds the rail from `LAYOUT_BREAKPOINTS.phone` up.
   * `closeSheet` is for a control in the navigation that opens something
   * over it (settings, from the session footer): on a phone, where the
   * navigation is a page, it brings Work into view; from
   * `LAYOUT_BREAKPOINTS.phone` up, where the navigation is a column, it does
   * nothing. `phone` is the pager's menu page (the stock `isMobile`), where
   * the navigation draws the page's head and `toggle` closes it.
   */
  nav: (panel: {
    collapsed: boolean;
    toggle: () => void;
    closeSheet: () => void;
    phone: boolean;
  }) => ReactNode;
  /**
   * The stage tabs, in a row across the files column and the stage, under the
   * shell's own stage bar; on a phone, in the preview page's bar
   */
  stageTabs: ReactNode;
  /**
   * The files column. `collapsed` is never true in the phone's Files Sheet;
   * `phone` says the column is in that Sheet, where `toggle` closes it.
   */
  files: (panel: {
    collapsed: boolean;
    toggle: () => void;
    phone: boolean;
  }) => ReactNode;
  /** The stage */
  stage: () => ReactNode;
  console: (panel: { open: boolean; toggle: () => void }) => ReactNode;
  /**
   * The assistant, in its panel or, below `LAYOUT_BREAKPOINTS.compact`, its
   * Sheet. `toggle` folds the panel or closes the Sheet; `wide` and `setWide`
   * size the panel to its maximum and back for the visit (`AssistantWide`),
   * and `canWiden` says when that can happen: never for the Sheet.
   */
  assistant: (
    panel: { open: boolean; toggle: () => void } & AssistantWide
  ) => ReactNode;
  /**
   * Home, in place of the assistant and the work: the navigation stays, the
   * stage, its tabs and the console are not rendered, the column bar over
   * Home reads "Home" with no files toggle, and the phone's work page shows
   * Home under the title "Home". A slot that renders nothing (the start is
   * still pending) holds Home's place with no title. `openAssistant`, like
   * the bar's assistant toggle, opens the assistant as a right Sheet, at
   * every width; it is the visit's and never saved. While Home holds its
   * place, the shell's keys (Ctrl+R, Ctrl+J, ⌘E) do nothing, and nor does a
   * deploy's opening of the console: they would change a saved layout or a
   * stage the screen does not show.
   */
  home?: (panel: { openAssistant: () => void }) => ReactNode;
  /**
   * A page (Tutorials, Programs) under a bar that names it, with no column
   * toggles. Under Home it takes Home's place; over the work it covers the
   * assistant and the work columns, which stay mounted under it. While it
   * shows, the shell's keys and a deploy's opening of the console do
   * nothing, as under Home. When the product asks for the assistant over
   * the work, `onClose` is called first, since the assistant is under the
   * page. On a phone the work page shows it, and opening it goes there.
   */
  cover?: { title: string; content: ReactNode; onClose: () => void };
  /** While Home shows, keep the work mounted (`BaseLayoutShellProps.keepWork`) */
  keepWork?: boolean;
}

/** Whether a key pressed on `target` is typed into something */
const isEditable = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
  ) !== null;

/**
 * The frame and the phone's pager, connected: the layout state and its
 * storage, the keys, the panels the product opens on its own, and the
 * `layout_*` events. Below `LAYOUT_BREAKPOINTS.phone` it drives `BasePhonePager`
 * instead of the columns; that page, view, Files Sheet and console are
 * visit state, never written to the saved layout.
 */
const LayoutShell = ({
  nav,
  stageTabs,
  files,
  stage,
  console,
  assistant,
  home,
  cover,
  keepWork,
}: LayoutShellProps) => {
  const viewport = useViewport();
  const phone = viewport === "phone";
  const theme = useTheme();
  const { state, setOpen, setHorizontal, setWork, setVertical } =
    useLayoutState();
  // The phone's state is the visit's: a phone writes nothing to `layout`
  const [page, setPage] = useState<PhonePage>("work");
  const [view, setView] = useState<WorkView>("code");
  const [filesOpen, setFilesOpen] = useState(false);
  const [phoneConsole, setPhoneConsole] = useState(false);
  // Held in state, not read off `PgFlow.state`, so a stage change re-renders
  const [flowStage, setFlowStage] = useState(PgFlow.state.stage);
  const lastPreview = useRef<PreviewStage>("build");
  // Mirror `filesOpen` and `phoneConsole` for the keys, which can fire twice
  // in a tick and for the subscriptions, which outlive renders
  const filesNow = useRef(false);
  const phoneConsoleNow = useRef(false);
  // The subscriptions below outlive renders, so they read these
  const pageRef = useRef(page);
  pageRef.current = page;
  const viewRef = useRef(view);
  viewRef.current = view;
  const screen = screenOf(home, cover);
  // Home is up, on screen or under a page: the assistant is Home's Sheet then
  const homeShown = homeOf(screen) !== undefined;
  // Read by the keys and the subscriptions, which outlive renders
  const screenNow = useRef(screen);
  screenNow.current = screen;
  // The assistant's Sheet while Home shows: the visit's, never saved
  const [homeSheetOpen, setHomeSheetOpen] = useState(false);
  const homeSheetNow = useRef(false);
  useExplorer();
  // The project's name shows in the stage bar and the phone's bar; a rename
  // opens no file, so `useExplorer`'s events miss it
  useRenderOnChange(PgExplorer.onDidRenameWorkspace);
  // Below `LAYOUT_BREAKPOINTS.compact` the assistant is a Sheet, closed on
  // arrival and never saved
  const [sheetOpen, setSheetOpen] = useState(false);
  // Below `LAYOUT_BREAKPOINTS.compact` the navigation starts as a rail on
  // every load, whatever a wide window saved: there is no room for it beside
  // the files column and the stage. Unfolding it there is for the visit.
  const [railOpen, setRailOpen] = useState(false);
  // Mirrors `railOpen` for the handler, which a key can call twice in a tick
  const railNow = useRef(false);
  // The stock Sidebar handles Cmd+B itself and reports only the new state, so
  // a click on one of our buttons marks itself here first
  const navVia = useRef<ToggleSource | null>(null);
  // What a change nobody marked came from: a Sheet closed by Escape is a key,
  // one closed by a tap on its overlay a button
  const lastInput = useRef<ToggleSource>("key");

  useEffect(() => {
    // Each input says what it was, for a Sheet that reports a change nobody
    // marked (the assistant's, the phone's Files), and drops any mark a
    // toggle left, in the capture phase, before its own handler marks
    const onPointer = () => {
      lastInput.current = "button";
      navVia.current = null;
    };
    const onKey = () => {
      lastInput.current = "key";
      navVia.current = null;
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    layoutTelemetry.track("layout_viewport", { viewport });
    // Once per load, with the width the page opened at
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirrors `sheetOpen` so the effect below, which outlives renders, sees it
  const sheetNow = useRef(false);

  useEffect(() => {
    // Closed by the width, not by anyone: nothing to report
    if (viewport === "wide") {
      sheetNow.current = false;
      setSheetOpen(false);
    }
  }, [viewport]);

  const setSheet = (open: boolean, via: ToggleSource) => {
    if (sheetNow.current === open) return;
    sheetNow.current = open;
    setSheetOpen(open);
    layoutTelemetry.track("layout_panel_toggled", {
      panel: "assistant",
      open,
      via,
    });
  };

  const setHomeSheet = (open: boolean, via: ToggleSource) => {
    if (homeSheetNow.current === open) return;
    homeSheetNow.current = open;
    setHomeSheetOpen(open);
    layoutTelemetry.track("layout_panel_toggled", {
      panel: "assistant",
      open,
      via,
    });
  };
  useEffect(() => {
    // Gone with Home, not closed by anyone: nothing to report
    if (homeShown) return;
    const wasOpen = homeSheetNow.current;
    homeSheetNow.current = false;
    setHomeSheetOpen(false);
    // A conversation open on Home stays on screen when the work takes over
    // (sync's `adopt` can open a project mid-answer): the work's assistant
    // opens in its place, which between `LAYOUT_BREAKPOINTS.phone` and
    // `.compact` is a closed Sheet
    if (wasOpen) setAssistant(true, "auto");
    // `setAssistant` reads refs and the viewport of this render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeShown]);

  const showPage = (next: PhonePage, via: PageSource) => {
    if (pageRef.current === next) return;
    pageRef.current = next;
    setPage(next);
    layoutTelemetry.track("layout_page_shown", { page: next, via });
    const toStage = stageForPage(next, PgFlow.state.stage, lastPreview.current);
    if (toStage) PgFlow.setStage(toStage);
  };
  // The phone's Files sheet and console are the visit's: reported, never saved
  const setPhoneFiles = (open: boolean, via: ToggleSource) => {
    if (filesNow.current === open) return;
    filesNow.current = open;
    setFilesOpen(open);
    layoutTelemetry.track("layout_panel_toggled", {
      panel: "files",
      open,
      via,
    });
  };
  const setPhoneConsoleOpen = (open: boolean, via: ToggleSource) => {
    if (phoneConsoleNow.current === open) return;
    phoneConsoleNow.current = open;
    setPhoneConsole(open);
    layoutTelemetry.track("layout_panel_toggled", {
      panel: "console",
      open,
      via,
    });
  };
  const showView = (next: WorkView, via: WorkViewSource) => {
    if (viewRef.current === next) return;
    viewRef.current = next;
    setView(next);
    layoutTelemetry.track("layout_work_view", { view: next, via });
  };

  // A stage set from elsewhere moves the pager to the page that shows it
  useEffect(() => {
    const sub = PgFlow.onDidChange((flow) => {
      setFlowStage(flow.stage);
      // Tracked at every width, not only on a phone: the Preview a phone opens
      // on is the last non-write stage shown anywhere
      if (flow.stage !== "write") lastPreview.current = flow.stage;
      // Home and a page have no preview page to move to
      if (!phone || isCovered(screenNow.current)) return;
      const next = pageForStage(flow.stage, pageRef.current);
      if (next) showPage(next, "auto");
    });
    return () => sub.dispose();
    // `showPage` reads only refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  // Files closes when any file opens, and when a modal opens: the Sheet is a
  // modal dialog that traps focus, so a Rename opened from the file tree
  // could not be typed into while it stays open
  useEffect(() => {
    if (!phone) return;
    const subs = [
      PgExplorer.onDidOpenFile(() => setPhoneFiles(false, "auto")),
      PgView.onDidOpenModal(() => setPhoneFiles(false, "auto")),
    ];
    return () => subs.forEach((sub) => sub.dispose());
  }, [phone]);

  const wideOrSheet = viewport === "wide" ? state.open.assistant : sheetOpen;
  const pagerOrFrame = phone ? view === "chat" : wideOrSheet;
  const assistantShown = homeShown ? homeSheetOpen : pagerOrFrame;
  const setAssistant = (open: boolean, via: ToggleSource) => {
    const now = screenNow.current;
    // A page over the work covers the assistant: it makes way first
    if (open && now.kind === "page" && now.over === "work") now.cover.onClose();
    // Under Home the assistant is its Sheet at every width
    if (homeOf(now) !== undefined) setHomeSheet(open, via);
    else if (phone) {
      // A key keeps its own source; a drag never reaches a phone
      const source: PageSource =
        via === "key" || via === "auto" ? via : "button";
      showPage("work", source);
      // A drag only resizes the wide panel, so none reaches a phone: the
      // mapping only narrows the type
      showView(open ? "chat" : "code", via === "drag" ? "button" : via);
    } else if (viewport === "wide") setOpen("assistant", { open, via });
    else setSheet(open, via);
  };
  /**
   * The console opening on its own: the visit's on a phone, else saved. Not
   * under Home or a page, which show no console to open.
   */
  const openConsole = () => {
    if (isCovered(screenNow.current)) return;
    if (phone) setPhoneConsoleOpen(true, "auto");
    else setOpen("console", { open: true, via: "auto" });
  };

  // The handlers read what they toggle, so they are renewed with it
  useKeybind(
    "Ctrl+R",
    () => {
      if (isCovered(screenNow.current)) return;
      if (phone) {
        // The view is shown on Work: bring it into view first
        showPage("work", "key");
        showView(view === "chat" ? "code" : "chat", "key");
      } else setAssistant(!assistantShown, "key");
    },
    [viewport, assistantShown, view]
  );
  useKeybind(
    CONSOLE_KEY,
    () => {
      if (isCovered(screenNow.current)) return;
      if (phone) setPhoneConsoleOpen(!phoneConsoleNow.current, "key");
      else setOpen("console", { open: !state.open.console, via: "key" });
    },
    [viewport, state.open.console]
  );
  // `PgKeybind` reads Meta as Ctrl, so this is ⌘E on a Mac. Monaco binds ⌘E
  // (find with selection) while it has focus; this one wins only outside it.
  // On macOS a text field keeps Control+E, which Cocoa's text bindings make
  // "end of line" (the assistant's composer): a Control without a Meta in an
  // editable target is left to the field, unprevented. ⌘E has no native
  // meaning in one, so it still folds the column. On Windows and Linux Ctrl is
  // the primary modifier and means nothing in a field, so the key works
  // everywhere there, Monaco included.
  // On a phone the key toggles the pager's own Files Sheet.
  useKeybind(
    "Ctrl+E",
    {
      handle: (ev) => {
        // Before `preventDefault`: under Home or a page the key is not the shell's
        if (isCovered(screenNow.current)) return;
        if (
          PgCommon.getOS() === "MacOS" &&
          ev.ctrlKey &&
          !ev.metaKey &&
          isEditable(ev.target)
        ) {
          return;
        }
        // `PgKeybind` prevents the default itself unless told not to, which
        // would also swallow the keys left to a field above
        ev.preventDefault();
        if (phone) {
          setPhoneFiles(!filesNow.current, "key");
          return;
        }
        setOpen("files", { open: !state.open.files, via: "key" });
      },
      opts: { noPreventDefault: true },
    },
    [state.open.files, phone]
  );

  useEffect(() => {
    // `onDidChange` replays the current state first; that one is the baseline
    let prevDeploy: StageStatus | undefined;
    const subs = [
      PgCommand.deploy.onDidStart(openConsole),
      PgFlow.onDidChange((flow) => {
        if (
          prevDeploy !== undefined &&
          flow.deploy === "failed" &&
          prevDeploy !== "failed"
        ) {
          openConsole();
        }
        prevDeploy = flow.deploy;
      }),
      PgAssistant.onDidRequestPrompt(() => setAssistant(true, "auto")),
    ];
    return () => subs.forEach((sub) => sub.dispose());
    // `setOpen` is stable; `setAssistant` and `openConsole` change only with
    // the viewport
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  /** The mark a button left, else the last input; the mark is used once */
  const takeNavVia = (): ToggleSource => {
    const via = navVia.current ?? lastInput.current;
    navVia.current = null;
    return via;
  };
  const navOpen = viewport === "wide" ? state.open.nav : railOpen;
  // On a wide screen the change is saved; below it the rail's unfolding is
  // the visit's alone, so it is reported here and not saved
  const onNavOpenChange = (open: boolean) => {
    const via = takeNavVia();
    if (viewport === "wide") {
      setOpen("nav", { open, via });
      return;
    }
    if (railNow.current === open) return;
    railNow.current = open;
    setRailOpen(open);
    layoutTelemetry.track("layout_panel_toggled", { panel: "nav", open, via });
  };
  // The stock toggle. In the frame it calls `onNavOpenChange` before it
  // returns, so the mark is cleared right after and cannot outlive the click.
  // On a phone it moves the pager, which reports itself and reads no mark.
  const toggleNav = (stockToggle: () => void) => () => {
    navVia.current = "button";
    try {
      stockToggle();
    } finally {
      navVia.current = null;
    }
  };
  // On a phone the navigation is a page, and "closing" it goes back to Work
  const closeNav = () => {
    if (phone) showPage("work", "auto");
  };

  const filePath = PgExplorer.getCurrentFile()?.path;
  const relativeFile = filePath ? PgExplorer.getRelativePath(filePath) : null;
  const file = relativeFile
    ? {
        dir: relativeFile.slice(0, relativeFile.lastIndexOf("/") + 1),
        name: relativeFile.slice(relativeFile.lastIndexOf("/") + 1),
      }
    : null;
  const homeContent = home?.({
    openAssistant: () => setHomeSheet(true, "button"),
  });
  // Home's slot renders nothing while the start is pending; no title then,
  // so a returning user's load does not read "Home" before the work shows
  const homeTitle = homeContent == null ? null : "Home";

  // A page opened on a phone is shown at once, on the work page
  const coverShown = screen.kind === "page";
  useEffect(() => {
    if (coverShown && phone) showPage("work", "auto");
    // `showPage` reads only refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverShown, phone]);

  let phoneTitle = PgExplorer.currentWorkspaceName ?? "";
  if (screen.kind === "home") phoneTitle = homeTitle ?? "";
  if (screen.kind === "page") phoneTitle = screen.cover.title;

  // The bar names the project while the assistant is out of view, since its
  // head cannot; under Home it names Home, as the phone's bar does
  let barTitle: string | null = null;
  if (homeShown) barTitle = homeTitle;
  else if (!assistantShown) barTitle = PgExplorer.currentWorkspaceName ?? null;

  return (
    <BaseLayoutShell
      viewport={viewport}
      keepWork={keepWork}
      navOpen={navOpen}
      onNavOpenChange={onNavOpenChange}
      assistantState={{
        open: assistantShown,
        // A drag folds or unfolds the panel; the Sheet is closed by Escape or
        // a tap on its overlay, never dragged
        onOpenChange: (open) =>
          viewport === "wide"
            ? setOpen("assistant", { open, via: "drag" })
            : setSheet(open, lastInput.current),
      }}
      filesState={{
        open: state.open.files,
        onOpenChange: (open) => setOpen("files", { open, via: "drag" }),
      }}
      consoleState={{
        open: state.open.console,
        onOpenChange: (open) => setOpen("console", { open, via: "drag" }),
      }}
      horizontal={state.h}
      work={state.w}
      vertical={state.vert}
      onHorizontalLayout={setHorizontal}
      onWorkLayout={setWork}
      onVerticalLayout={setVertical}
      nav={(stock) =>
        nav({
          collapsed: stock.collapsed,
          toggle: toggleNav(stock.toggle),
          closeSheet: closeNav,
          phone: stock.isMobile,
        })
      }
      files={(stock) => {
        // In the phone's Files Sheet the column is always open, so a control
        // of its own, if it draws one, closes the Sheet, as ⌘E does there
        // (Flow's column draws none there: the Sheet has its own close)
        if (stock.isMobile) {
          return files({
            collapsed: false,
            toggle: toggleNav(stock.toggle),
            phone: true,
          });
        }
        return files({
          collapsed: !state.open.files,
          toggle: () =>
            setOpen("files", { open: !state.open.files, via: "button" }),
          phone: false,
        });
      }}
      // The product's text face, as the desktop's column has it: the code
      // face leaked into every button of a Sheet, which inherit their font.
      // The size stays the one the legacy file tree is laid out at.
      sheetFont={{
        fontFamily: theme.font.other.family,
        fontSize: theme.font.code.size.medium,
      }}
      phone={{
        page,
        onSwipe: (next) => showPage(next, "swipe"),
        onGo: (next) => showPage(next, "button"),
        view,
        onView: (next) => showView(next, "button"),
        title: phoneTitle,
        file,
        filesOpen,
        onFilesOpenChange: (open) => setPhoneFiles(open, lastInput.current),
        stageOn: stagePageOf(flowStage),
        consoleOpen: phoneConsole,
      }}
      stageBar={
        <BaseStageBar
          title={barTitle}
          // Under Home there is no files column to toggle
          files={
            homeShown
              ? null
              : {
                  open: state.open.files,
                  onToggle: () =>
                    setOpen("files", {
                      open: !state.open.files,
                      via: "button",
                    }),
                }
          }
          // The panel's toggle on a wide window; below it, and at every width
          // under Home, what opens the Sheet
          assistant={{
            open: assistantShown,
            onToggle: () => setAssistant(!assistantShown, "button"),
          }}
          // Under Home Ctrl+R does nothing, so the hint names no key
          assistantKey={homeShown ? null : "Ctrl+R"}
        />
      }
      stageTabs={stageTabs}
      stage={stage()}
      console={console({
        open: phone ? phoneConsole : state.open.console,
        toggle: () => {
          if (phone) setPhoneConsoleOpen(!phoneConsoleNow.current, "button");
          else setOpen("console", { open: !state.open.console, via: "button" });
        },
      })}
      assistant={({ wide, setWide, canWiden }) =>
        assistant({
          open: assistantShown,
          toggle: () => setAssistant(!assistantShown, "button"),
          wide,
          // Only the user's click is measured, and only a change the shell
          // made: its own narrowing on a fold never comes through here
          setWide: (next) => {
            const changed = setWide(next);
            if (changed) {
              layoutTelemetry.track("layout_assistant_widened", { wide: next });
            }
            return changed;
          },
          canWiden,
        })
      }
      cover={
        cover && {
          bar: (
            <BaseStageBar
              title={cover.title}
              files={null}
              assistant={null}
              assistantKey={null}
            />
          ),
          content: cover.content,
        }
      }
      home={
        home && {
          content: homeContent,
          assistant: {
            open: homeSheetOpen,
            // Closed by Escape or a tap on its overlay
            onOpenChange: (open) => setHomeSheet(open, lastInput.current),
          },
        }
      }
    />
  );
};

export default LayoutShell;
