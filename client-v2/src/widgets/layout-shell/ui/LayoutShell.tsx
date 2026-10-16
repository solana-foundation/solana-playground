import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTheme } from "styled-components";

import { useKeybind } from "@/hooks";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { PgCommand, PgEditor, PgView } from "@/utils";
import { PgFlow } from "@/views/flow/state/stage";
import type { StageStatus } from "@/views/flow/state/stage";
import { PgAssistant } from "@/views/sidebar/assistant/store";
import { layoutTelemetry } from "../model/telemetry";
import type { ToggleSource } from "../model/telemetry";
import { useLayoutState } from "../model/use-layout-state";
import BaseLayoutShell from "./BaseLayoutShell";

export interface LayoutShellProps {
  /**
   * `collapsed` is never true in the Sheet below `LAYOUT_BREAKPOINTS.left`,
   * which has no rail
   */
  left: (panel: { collapsed: boolean; toggle: () => void }) => ReactNode;
  stage: ReactNode;
  console: (panel: { open: boolean; toggle: () => void }) => ReactNode;
  assistant: (panel: { open: boolean; toggle: () => void }) => ReactNode;
}

/**
 * The area under Flow's header, connected: the layout state and its storage,
 * the keys, the panels the product opens on its own, and the `layout_*`
 * events.
 */
const LayoutShell = ({ left, stage, console, assistant }: LayoutShellProps) => {
  const viewport = useViewport();
  const theme = useTheme();
  const { state, setOpen, setHorizontal, setVertical } = useLayoutState();
  // Below `LAYOUT_BREAKPOINTS.compact` the assistant is a Sheet, closed on
  // arrival and never saved
  const [sheetOpen, setSheetOpen] = useState(false);
  // The stock Sidebar handles Cmd+B itself and reports only the new state, so
  // a click on one of our buttons marks itself here first
  const leftVia = useRef<ToggleSource | null>(null);
  // What a change nobody marked came from: a Sheet closed by Escape is a key,
  // one closed by a tap on its overlay a button
  const lastInput = useRef<ToggleSource>("key");

  useEffect(() => {
    const onPointer = () => (lastInput.current = "button");
    const onKey = () => (lastInput.current = "key");
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
  const takeLeftVia = (): ToggleSource => {
    const via = leftVia.current ?? lastInput.current;
    leftVia.current = null;
    return via;
  };
  const onLeftOpenChange = (open: boolean) =>
    setOpen("left", { open, via: takeLeftVia() });
  // The stock toggle. On a desktop it calls `onLeftOpenChange` before it
  // returns, so the mark is cleared right after and cannot outlive the click.
  // Below `LAYOUT_BREAKPOINTS.left` it flips the Sheet, which
  // `onLeftSheetChange` reports a render later and so takes the mark itself.
  const toggleLeft = (stockToggle: () => void, isMobile: boolean) => () => {
    leftVia.current = "button";
    try {
      stockToggle();
    } finally {
      if (!isMobile) leftVia.current = null;
    }
  };
  const onLeftSheetChange = (open: boolean) =>
    layoutTelemetry.track("layout_panel_toggled", {
      panel: "left",
      open,
      via: takeLeftVia(),
    });

  // A modal closes the Sheet, which traps focus away from it: the product's
  // doing, not the user's, so it is reported as `auto`. The mark is dropped
  // when there was no Sheet to close, so it cannot label a later toggle.
  const closeLeftSheetOnModal = useCallback(
    (close: () => boolean) =>
      PgView.onDidOpenModal(() => {
        leftVia.current = "auto";
        if (!close()) leftVia.current = null;
      }),
    []
  );

  return (
    <BaseLayoutShell
      viewport={viewport}
      leftOpen={state.open.left}
      onLeftOpenChange={onLeftOpenChange}
      assistantState={{
        open: assistantShown,
        // A drag folds or unfolds the panel; the Sheet is closed by Escape or
        // a tap on its overlay, never dragged
        onOpenChange: (open) =>
          viewport === "wide"
            ? setOpen("assistant", { open, via: "drag" })
            : setSheet(open, lastInput.current),
      }}
      consoleState={{
        open: state.open.console,
        onOpenChange: (open) => setOpen("console", { open, via: "drag" }),
      }}
      horizontal={state.h}
      vertical={state.vert}
      onHorizontalLayout={setHorizontal}
      onVerticalLayout={setVertical}
      left={({ toggle, isMobile }) =>
        left({
          collapsed: isMobile ? false : !state.open.left,
          toggle: toggleLeft(toggle, isMobile),
        })
      }
      onLeftSheetChange={onLeftSheetChange}
      closeLeftSheetOn={closeLeftSheetOnModal}
      sheetFont={{
        fontFamily: theme.font.code.family,
        fontSize: theme.font.code.size.medium,
      }}
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
