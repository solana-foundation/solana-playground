import type { FC, ReactNode } from "react";

import { Button } from "@/shared/ui/button";
import {
  ConsoleDrawer,
  ConsoleDrawerActions,
  ConsoleDrawerBar,
  ConsoleDrawerContent,
  ConsoleDrawerStatus,
} from "@/shared/ui/console-drawer";
import { Kbd } from "@/shared/ui/kbd";
import { StatusDot } from "@/shared/ui/status-dot";
import type { RunKind } from "../state/stage";
import type { ConsoleStatus } from "./status";

/** The well's id. The Terminal button's `aria-controls` names it, and the
 * drawer's unit tests find the body by it; no e2e does. */
export const CONSOLE_BODY_ID = "flow-console-drawer-body";

interface BaseConsoleDrawerProps {
  open: boolean;
  /** The state the drawer asks for, which may be the one it is in */
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
  /** The run Stop names and the handler that stops it, while a build or a
   * deploy runs; `null` otherwise */
  stop: { run: RunKind; onStop: () => void } | null;
  status: ConsoleStatus;
  /** The toggle's key: "⌘J" on a Mac, "Ctrl+J" elsewhere */
  shortcut: string;
  children?: ReactNode;
}

/**
 * The console under the stage, drawn from the design system's drawer. The
 * layout shell owns its height (folded, it is `BOTTOM_BAR_PX` tall: the
 * strip alone) and the shortcut, so the drawer's own hotkey is off and the
 * well fills whatever height the panel has. The bar's `h-bar` is the design
 * system's `--layout-bar` and must equal `BOTTOM_BAR_PX`, or the folded panel
 * cuts the bar or leaves a gap under it.
 */
const BaseConsoleDrawer: FC<BaseConsoleDrawerProps> = ({
  open,
  onOpenChange,
  onClear,
  stop,
  status,
  shortcut,
  children,
}) => (
  <ConsoleDrawer
    open={open}
    onOpenChange={onOpenChange}
    hotkey={null}
    contentId={CONSOLE_BODY_ID}
    className="h-full bg-surface"
  >
    <ConsoleDrawerBar triggerLabel="Terminal" className="shrink-0">
      <ConsoleDrawerStatus>
        <StatusDot variant={status.tone} />
        <span
          data-console-label
          className="font-semibold tracking-wide text-foreground"
        >
          Terminal
        </span>
        {status.text && (
          <span className={status.tone === "error" ? "text-error" : undefined}>
            {status.text}
          </span>
        )}
      </ConsoleDrawerStatus>
      <ConsoleDrawerActions>
        <Kbd aria-hidden>{shortcut}</Kbd>
        {/* Spec 13: while a build or a deploy runs, Clear is off with Stop
            beside it; on a phone Stop takes Clear's place, a fingertip
            wide. Stop shows folded too: the strip is all a folded console
            shows. */}
        {open && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!!stop}
            className={stop ? "max-md:hidden" : undefined}
            onClick={onClear}
          >
            Clear
          </Button>
        )}
        {stop && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Stop ${stop.run}`}
            className="max-md:min-h-11 max-md:min-w-11"
            onClick={stop.onStop}
          >
            Stop
          </Button>
        )}
      </ConsoleDrawerActions>
    </ConsoleDrawerBar>
    {/* The panel sets the height on every width: `h-auto` undoes the
        drawer's own fixed well, and the `max-md` override undoes its phone
        height (45dvh), which would otherwise outrank `h-auto` there. */}
    <ConsoleDrawerContent className="flex h-auto min-h-0 flex-1 flex-col overflow-hidden max-md:data-[state=open]:h-auto">
      {/* The terminal's own root has no height. One grid cell the well's
          size stretches it, whatever element it is, so xterm's fit sees a
          real size and counts the right rows. The column is `minmax(0,1fr)`
          too: an `auto` one is never narrower than the terminal's own width,
          so the terminal outgrows a narrowing stage and fit, which takes the
          scrollbar off that width, gets there one scrollbar per pass. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        {children}
      </div>
    </ConsoleDrawerContent>
  </ConsoleDrawer>
);

export default BaseConsoleDrawer;
