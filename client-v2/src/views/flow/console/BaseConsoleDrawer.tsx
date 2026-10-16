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
import type { ConsoleStatus } from "./status";

/** The well's id. The Console button's `aria-controls` names it, and the
 * drawer's unit tests find the body by it; no e2e does. */
export const CONSOLE_BODY_ID = "flow-console-drawer-body";

interface BaseConsoleDrawerProps {
  open: boolean;
  /** The state the drawer asks for, which may be the one it is in */
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
  status: ConsoleStatus;
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
  status,
  children,
}) => (
  <ConsoleDrawer
    open={open}
    onOpenChange={onOpenChange}
    hotkey={null}
    contentId={CONSOLE_BODY_ID}
    className="h-full rounded-b-md border border-t-0 border-border bg-surface"
  >
    <ConsoleDrawerBar triggerLabel="Console" className="shrink-0">
      <ConsoleDrawerStatus>
        <StatusDot variant={status.tone} />
        <span
          data-console-label
          className="font-semibold tracking-wide text-foreground"
        >
          Console
        </span>
        {status.text && (
          <span className={status.tone === "error" ? "text-error" : undefined}>
            {status.text}
          </span>
        )}
      </ConsoleDrawerStatus>
      <ConsoleDrawerActions>
        <Kbd aria-hidden>⌘J</Kbd>
        {open && (
          <Button type="button" variant="ghost" size="xs" onClick={onClear}>
            Clear
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
          real size and counts the right rows. */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]">
        {children}
      </div>
    </ConsoleDrawerContent>
  </ConsoleDrawer>
);

export default BaseConsoleDrawer;
