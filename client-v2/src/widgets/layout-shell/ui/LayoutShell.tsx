import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "styled-components";

import { useKeybind } from "@/hooks";
import { useIsLeftSheet, useViewport } from "@/shared/lib/hooks/use-viewport";
import { PgCommand, PgCommon, PgEditor, PgView } from "@/utils";
import { PgFlow } from "@/views/flow/state/stage";
import type { StageStatus } from "@/views/flow/state/stage";
import { PgAssistant } from "@/views/sidebar/assistant/store";
import { layoutTelemetry } from "../model/telemetry";
import type { ToggleSource } from "../model/telemetry";
import { useLayoutState } from "../model/use-layout-state";
import BaseLayoutShell from "./BaseLayoutShell";

export interface LayoutShellProps {
  /**
   * The navigation. `collapsed` is never true in the Sheet below
   * `LAYOUT_BREAKPOINTS.left`, which has no rail; `toggle` folds the rail
   * from there up and opens or closes the Sheet below it. `closeSheet` is for
   * a control in the navigation that opens something the Sheet's modal
   * overlay would cover (settings, from the status chips): it closes the
   * Sheet as the product's doing, `via: "auto"`, and does nothing where no
   * Sheet is open.
   */
  nav: (panel: {
    collapsed: boolean;
    toggle: () => void;
    closeSheet: () => void;
  }) => ReactNode;
  /** Across the top of the files column and the stage */
  stageBar: ReactNode;
  /**
   * The files column. `collapsed` is never true in the Sheet below
   * `LAYOUT_BREAKPOINTS.left`, where it sits open under the navigation.
   */
  files: (panel: { collapsed: boolean; toggle: () => void }) => ReactNode;
  stage: ReactNode;
  console: (panel: { open: boolean; toggle: () => void }) => ReactNode;
  assistant: (panel: { open: boolean; toggle: () => void }) => ReactNode;
}

/** Whether a key pressed on `target` is typed into something */
const isEditable = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
  ) !== null;

/**
 * The four-column frame, connected: the layout state and its storage, the
 * keys, the panels the product opens on its own, and the `layout_*` events.
 */
const LayoutShell = ({
  nav,
  stageBar,
  files,
  stage,
  console,
  assistant,
}: LayoutShellProps) => {
  const viewport = useViewport();
  const isMobile = useIsLeftSheet();
  const theme = useTheme();
  const { state, setOpen, setHorizontal, setWork, setVertical } =
    useLayoutState();
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
  // What toggles the navigation's Sheet below `LAYOUT_BREAKPOINTS.left`, from
  // `toggleLeftSheetOn`; it says whether there was a Sheet to toggle
  const sheetToggle = useRef<(() => boolean) | null>(null);
  // What a change nobody marked came from: a Sheet closed by Escape is a key,
  // one closed by a tap on its overlay a button
  const lastInput = useRef<ToggleSource>("key");

  useEffect(() => {
    // A mark outlives its input only when the Sheet it toggled ended the tick
    // as it began (two toggles in one tick) and so reported nothing; the next
    // input drops it, in the capture phase, before its own handler marks
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

  const assistantShown = viewport === "wide" ? state.open.assistant : sheetOpen;
  const setAssistant = (open: boolean, via: ToggleSource) => {
    if (viewport === "wide") setOpen("assistant", { open, via });
    else setSheet(open, via);
  };

  // The handlers read what they toggle, so they are renewed with it
  useKeybind("Ctrl+R", () => setAssistant(!assistantShown, "key"), [
    viewport,
    assistantShown,
  ]);
  useKeybind(
    "Ctrl+J",
    () => setOpen("console", { open: !state.open.console, via: "key" }),
    [state.open.console]
  );
  // `PgKeybind` reads Meta as Ctrl, so this is ⌘E on a Mac. Monaco binds ⌘E
  // (find with selection) while it has focus; this one wins only outside it.
  // On macOS a text field keeps Control+E, which Cocoa's text bindings make
  // "end of line" (the assistant's composer): a Control without a Meta in an
  // editable target is left to the field, unprevented. ⌘E has no native
  // meaning in one, so it still folds the column. On Windows and Linux Ctrl is
  // the primary modifier and means nothing in a field, so the key works
  // everywhere there, Monaco included.
  // Below `LAYOUT_BREAKPOINTS.left` the files column is in the navigation's
  // Sheet, so the key opens and closes that Sheet, which reports itself as
  // `nav` a render later and takes the mark; the column's desktop flag, which
  // nothing there shows, is left alone.
  useKeybind(
    "Ctrl+E",
    {
      handle: (ev) => {
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
        navVia.current = "key";
        if (sheetToggle.current?.()) return;
        // A defence: the next pointer or key input clears the mark in the
        // capture phase anyway, so no test can tell this line from its absence
        navVia.current = null;
        setOpen("files", { open: !state.open.files, via: "key" });
      },
      opts: { noPreventDefault: true },
    },
    [state.open.files]
  );

  useEffect(() => {
    // `onDidChange` replays the current state first; that one is the baseline
    let prevDeploy: StageStatus | undefined;
    const subs = [
      PgCommand.deploy.onDidStart(() =>
        setOpen("console", { open: true, via: "auto" })
      ),
      PgFlow.onDidChange((flow) => {
        if (
          prevDeploy !== undefined &&
          flow.deploy === "failed" &&
          prevDeploy !== "failed"
        ) {
          setOpen("console", { open: true, via: "auto" });
        }
        prevDeploy = flow.deploy;
      }),
      PgAssistant.onDidRequestPrompt(() => setAssistant(true, "auto")),
    ];
    return () => subs.forEach((sub) => sub.dispose());
    // `setOpen` is stable; `setAssistant` changes only with the viewport
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport]);

  useEffect(() => {
    let reported = false;
    const onBlocked = () => {
      if (reported) return;
      reported = true;
      layoutTelemetry.track("layout_readonly_edit_blocked", {});
    };
    document.addEventListener(PgEditor.events.READ_ONLY_EDIT, onBlocked);
    return () =>
      document.removeEventListener(PgEditor.events.READ_ONLY_EDIT, onBlocked);
  }, []);

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
  // The stock toggle. From `LAYOUT_BREAKPOINTS.left` up it calls
  // `onNavOpenChange` before it returns, so the mark is cleared right after
  // and cannot outlive the click. Below it it flips the Sheet, which
  // `onLeftSheetChange` reports a render later and so takes the mark itself.
  const toggleNav = (stockToggle: () => void, isMobile: boolean) => () => {
    navVia.current = "button";
    try {
      stockToggle();
    } finally {
      if (!isMobile) navVia.current = null;
    }
  };
  // The stock Sidebar's Sheet holds the navigation and the files column; it
  // is the navigation's Sheet, so it is reported as `nav`
  const onLeftSheetChange = (open: boolean) =>
    layoutTelemetry.track("layout_panel_toggled", {
      panel: "nav",
      open,
      via: takeNavVia(),
    });

  // Keeps the base's Sheet toggle for ⌘E; the one in place is the live one
  const toggleLeftSheetOn = useCallback((toggle: () => boolean) => {
    sheetToggle.current = toggle;
    return {
      dispose: () => {
        if (sheetToggle.current === toggle) sheetToggle.current = null;
      },
    };
  }, []);

  // What closes the navigation's Sheet, from `closeLeftSheetOn`
  const sheetClose = useRef<(() => boolean) | null>(null);
  // A modal, or settings opened from the navigation's own chips, closes the
  // Sheet: the Sheet is a modal dialog that traps focus and covers both. The
  // product's doing, not the user's, so it is reported as `auto`. The mark is
  // dropped when there was no Sheet to close, so it cannot label a later
  // toggle.
  const closeSheetAuto = useCallback(() => {
    navVia.current = "auto";
    if (!sheetClose.current?.()) navVia.current = null;
  }, []);
  const closeLeftSheetOn = useCallback(
    (close: () => boolean) => {
      sheetClose.current = close;
      const sub = PgView.onDidOpenModal(closeSheetAuto);
      return {
        dispose: () => {
          sub.dispose();
          if (sheetClose.current === close) sheetClose.current = null;
        },
      };
    },
    [closeSheetAuto]
  );

  return (
    <BaseLayoutShell
      viewport={viewport}
      isMobile={isMobile}
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
          toggle: toggleNav(stock.toggle, stock.isMobile),
          closeSheet: closeSheetAuto,
        })
      }
      files={(stock) => {
        // In the Sheet the column is always open, so its button closes the
        // Sheet, as ⌘E does there
        if (stock.isMobile) {
          return files({
            collapsed: false,
            toggle: toggleNav(stock.toggle, true),
          });
        }
        return files({
          collapsed: !state.open.files,
          toggle: () =>
            setOpen("files", { open: !state.open.files, via: "button" }),
        });
      }}
      onLeftSheetChange={onLeftSheetChange}
      closeLeftSheetOn={closeLeftSheetOn}
      toggleLeftSheetOn={toggleLeftSheetOn}
      sheetFont={{
        fontFamily: theme.font.code.family,
        fontSize: theme.font.code.size.medium,
      }}
      stageBar={stageBar}
      stage={stage}
      console={console({
        open: state.open.console,
        toggle: () =>
          setOpen("console", { open: !state.open.console, via: "button" }),
      })}
      assistant={assistant({
        open: assistantShown,
        toggle: () => setAssistant(!assistantShown, "button"),
      })}
      assistantOpener={
        <button
          type="button"
          aria-label="Expand assistant"
          className="rounded-l-md border border-r-0 border-border bg-card px-1.5 py-2 text-muted-foreground hover:text-foreground"
          onClick={() => setAssistant(true, "button")}
        >
          &#8249;
        </button>
      }
    />
  );
};

export default LayoutShell;
