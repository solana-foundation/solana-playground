import type { FC, ReactNode } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { Button } from "@/shared/ui/button";
import {
  ConsoleDrawer,
  ConsoleDrawerActions,
  ConsoleDrawerBar,
  ConsoleDrawerContent,
  ConsoleDrawerStatus,
} from "@/shared/ui/console-drawer";
import { CopyButton } from "@/shared/ui/copy-button";
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
  /** The terminal's text for Copy, read when the console opens and as a run moves */
  log: string;
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
  log,
  children,
}) => (
  <ConsoleDrawer
    open={open}
    onOpenChange={onOpenChange}
    hotkey={null}
    contentId={CONSOLE_BODY_ID}
    // On a phone the open console is a sheet (`BasePhonePager`): its bar
    // rides on top as the sheet's head, under a grabber
    className="h-full bg-surface max-md:flex-col"
  >
    {open && (
      <div
        aria-hidden
        className="flex shrink-0 justify-center bg-surface-well pt-2 md:hidden"
      >
        <span className="h-1 w-9 rounded-full bg-border" />
      </div>
    )}
    <ConsoleDrawerBar
      triggerLabel="Terminal"
      // A finger's 44 px on a phone, the bar and every control on it, with
      // 20 px glyphs and 14 px words; the chevron is the drawer's own, so it
      // is sized from here. Open, the bar is the sheet's head: one surface
      // with the log under it, a hairline between them, and 12 px more under
      // its row so the words sit as far from the hairline as from the edge
      className="shrink-0 max-md:h-11 max-md:px-3 max-md:text-sm max-md:[&_[data-slot=console-drawer-trigger]]:size-11 max-md:[&_[data-slot=console-drawer-trigger]_svg]:size-5 max-md:group-data-[state=open]/console-drawer:h-14 max-md:group-data-[state=open]/console-drawer:pb-3 max-md:group-data-[state=open]/console-drawer:border-t-0 max-md:group-data-[state=open]/console-drawer:border-b max-md:group-data-[state=open]/console-drawer:bg-surface-well"
    >
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
      <ConsoleDrawerActions className="gap-2 max-md:gap-0">
        {/* No keyboard on a phone to press it with */}
        <Kbd aria-hidden className="max-md:hidden">
          {shortcut}
        </Kbd>
        {/* Spec 08: the full log comes with a Copy */}
        {open && log && (
          <CopyButton
            value={log}
            label="Copy log"
            className="max-md:min-h-11 max-md:min-w-11 max-md:[&_svg]:size-5!"
            onError={reportButtonFailure("copy the log")}
          />
        )}
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
            className={
              stop
                ? "max-md:hidden"
                : "max-md:min-h-11 max-md:min-w-11 max-md:text-sm"
            }
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
