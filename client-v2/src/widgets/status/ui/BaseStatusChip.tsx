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
import { DOT, IndicatorDot, StatusDetail } from "./parts";

export interface BaseStatusChipProps {
  chip: ChipView;
  /** Network, AI, Rust analyzer, in that order */
  indicators: readonly StatusIndicator[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A row's action was picked; the sheet closes first */
  onAction: (indicator: StatusIndicator) => void;
}

/**
 * The phone's status: one chip in the work page's bar with the worst of the
 * three, and a sheet from the bottom with a row for each (Spec 06, "On a
 * phone"). Every target is a fingertip tall. When the bar runs out of room
 * the chip gives way before the project's name: it shrinks to its dot, and
 * its name still says it all.
 */
const BaseStatusChip = ({
  chip,
  indicators,
  open,
  onOpenChange,
  onAction,
}: BaseStatusChipProps) => (
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
    <SheetContent side="bottom" className="rounded-t-2xl pb-6">
      <SheetHeader>
        <SheetTitle>Status</SheetTitle>
        <SheetDescription className="sr-only">
          The network, the AI and the Rust analyzer
        </SheetDescription>
      </SheetHeader>
      <ul className="flex flex-col gap-4 px-4">
        {indicators.map((indicator) => (
          <li
            key={indicator.id}
            data-status={indicator.id}
            data-state-kind={indicator.state}
            className="flex flex-col gap-2"
          >
            <div className="flex min-h-11 items-center gap-2">
              <IndicatorDot state={indicator.state} />
              <span className="font-act text-foreground">{indicator.name}</span>
              <span className="ml-auto truncate text-muted-foreground">
                {indicator.words}
              </span>
            </div>
            <StatusDetail
              indicator={indicator}
              onAction={(picked) => {
                onOpenChange(false);
                onAction(picked);
              }}
            />
          </li>
        ))}
      </ul>
    </SheetContent>
  </Sheet>
);

export default BaseStatusChip;
