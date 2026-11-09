import { useEffect, useRef } from "react";

import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";
import { StatusDot } from "@/shared/ui/status-dot";

import type { ChipView, StatusIndicator } from "../model/indicators";
import { DOT, IndicatorDot, RetryButton, stateWords } from "./parts";

/** Centred on the name and the state; 28 px to the eye, a fingertip tall to the
 * touch (Spec 06, "Accessibility") */
const ROW_BUTTON =
  "relative after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']";

export interface BaseStatusChipProps {
  chip: ChipView;
  /** Network, AI, Rust analyzer, in that order */
  indicators: readonly StatusIndicator[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A row's action was picked; the sheet closes first */
  onAction: (indicator: StatusIndicator) => void;
  /** A row's Try again; the sheet stays open to show what it found */
  onRetry: (indicator: StatusIndicator) => Promise<unknown>;
}

/**
 * The phone's status: one chip in the work page's bar with the worst of the
 * three, and a sheet from the bottom with a row for each (Spec 06, "On a
 * phone"), grouped as a settings list is: the name and its state, the one
 * action beside them, and why only while not ready. Every target is a
 * fingertip tall. When the bar runs out of room
 * the chip gives way before the project's name: it shrinks to its dot, and
 * its name still says it all.
 */
const BaseStatusChip = ({
  chip,
  indicators,
  open,
  onOpenChange,
  onAction,
  onRetry,
}: BaseStatusChipProps) => {
  // A Try again that is answered takes its button away, and the sheet has no
  // focus return as the row and the rail do: focus that the button held moves
  // to that row's name, so a keyboard user keeps their place
  const retried = useRef<StatusIndicator["id"]>(undefined);
  const sheet = useRef<HTMLDivElement>(null);
  const retry = (indicator: StatusIndicator) => {
    retried.current = indicator.id;
    return onRetry(indicator);
  };
  useEffect(() => {
    const id = retried.current;
    if (id === undefined) return;
    if (indicators.find((i) => i.id === id)?.panel?.retry) return;
    retried.current = undefined;
    // Only when the removed button held the focus: it then falls to the body,
    // or to the sheet the focus trap keeps it in. A user who moved on to
    // another control while the retry ran keeps their place
    const active = document.activeElement;
    if (active && active !== document.body && active !== sheet.current) return;
    sheet.current
      ?.querySelector<HTMLElement>(`[data-status="${id}"] [data-focus-return]`)
      ?.focus();
  }, [indicators]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          aria-label={chip.label}
          data-testid="status-chip"
          data-state-kind={chip.state}
          // The words wrap onto a second line the fixed height clips, so a chip
          // squeezed below its full width is the dot alone rather than cut words
          className="h-11 min-w-11 shrink-[100] flex-wrap content-start gap-x-1.5 overflow-hidden rounded-full px-2.5 text-control font-act"
        >
          <span className="flex h-full items-center">
            <StatusDot variant={DOT[chip.state]} size="lg" />
          </span>
          <span className="flex h-full items-center">{chip.words}</span>
        </Button>
      </SheetTrigger>
      <SheetContent ref={sheet} side="bottom" className="rounded-t-2xl pb-6">
        {/* The chip's words under the title: what the sheet adds up to */}
        <SheetHeader className="pb-2">
          <SheetTitle>Status</SheetTitle>
          <SheetDescription>{chip.words}</SheetDescription>
        </SheetHeader>
        {/* One group, a row each: the name and its state on the left, its one
          action on the right, and why only for what is not ready */}
        <ul className="mx-4 flex flex-col divide-y divide-border rounded-xl border border-border">
          {indicators.map((indicator) => (
            <li
              key={indicator.id}
              data-status={indicator.id}
              data-state-kind={indicator.state}
              // The name and the action share the first line; the state and why
              // run under the name, as wide as the row, so they never wrap early
              className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 py-3 pr-3 pl-4"
            >
              <IndicatorDot state={indicator.state} />
              <span
                data-focus-return
                tabIndex={-1}
                className="font-act text-foreground outline-none"
              >
                {indicator.name}
              </span>
              <div className="row-span-2 flex items-center gap-2">
                {indicator.panel?.retry && (
                  <RetryButton
                    indicator={indicator}
                    onRetry={retry}
                    className={ROW_BUTTON}
                  />
                )}
                {indicator.action && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={ROW_BUTTON}
                    // The row names what changes, so the button shows the verb
                    // alone and leaves the state its line; the name keeps it all
                    aria-label={indicator.action.text}
                    onClick={() => {
                      onOpenChange(false);
                      onAction(indicator);
                    }}
                  >
                    {indicator.action.text.split(" ")[0]}
                  </Button>
                )}
              </div>
              <span className="col-start-2 text-sm text-muted-foreground">
                {stateWords(indicator)}
              </span>
              {indicator.state !== "ready" && indicator.detail && (
                <p className="col-span-2 col-start-2 mt-2 text-xs leading-relaxed text-pretty text-muted-foreground">
                  {indicator.detail}
                </p>
              )}
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
};

export default BaseStatusChip;
