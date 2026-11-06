import { Check, RotateCcw } from "lucide-react";

import type { StepBarItem } from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";

/** A step as the steps sheet lists it: the step bar's item and its objective */
export type PhoneStep = StepBarItem & { objective: string };

/**
 * The phone's sheets, drawn one way (Almaz's `sheets/sheet.ts`): the panel's
 * grey with rounder top corners, no rule round it, a soft shadow lifting it
 * off the page, and a handle that shows
 */
export const PHONE_SHEET =
  "max-h-[82dvh] gap-0 rounded-t-2xl bg-surface-panel shadow-[0_-12px_40px_rgb(0_0_0/0.45)] data-[side=bottom]:border-t-0";

const ROW =
  "flex w-full items-center gap-3 rounded-lg px-2 text-left outline-none active:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-purple";

export interface BaseStepsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tutorial's name, the sheet's title */
  name: string;
  steps: readonly PhoneStep[];
  /** Steps passed so far */
  passed: number;
  /** Start has been pressed: "Start over…" shows */
  started: boolean;
  /** A reached step was picked, by its index */
  onPick: (index: number) => void;
  /** "Start over…" was pressed; absent, the row does not show */
  onStartOver?: () => void;
}

/** A step's mark: its number on a grey disc, a lighter disc while current, a check once done */
const Glyph = ({
  index,
  state,
}: {
  index: number;
  state: PhoneStep["state"];
}) => (
  <span
    aria-hidden
    className={cn(
      "grid size-5 shrink-0 place-items-center rounded-full text-[0.6875rem] leading-none font-act tabular-nums",
      state === "current"
        ? "bg-foreground/20 text-foreground"
        : "bg-foreground/10 text-muted-foreground"
    )}
  >
    {state === "done" ? <Check className="size-3" /> : index + 1}
  </span>
);

/**
 * The phone's steps: every step with its title and objective, as rows. A
 * reached one takes the chat back to its divider; nothing resets. Under them
 * "Start over…", which the header asks about first.
 */
const BaseStepsSheet = ({
  open,
  onOpenChange,
  name,
  steps,
  passed,
  started,
  onPick,
  onStartOver,
}: BaseStepsSheetProps) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="bottom" showCloseButton={false} className={PHONE_SHEET}>
      <div
        aria-hidden
        className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-foreground/20"
      />
      <SheetHeader className="gap-1 px-4 pt-3 pb-2 text-left">
        <SheetTitle className="text-[1rem] leading-[1.35]">{name}</SheetTitle>
        <SheetDescription className="text-caption">
          {passed} of {steps.length} steps done. Tap one to read it again.
        </SheetDescription>
      </SheetHeader>
      <nav
        aria-label="Tutorial steps"
        className="flex flex-col gap-1 overflow-y-auto px-2 pt-1 pb-[max(env(safe-area-inset-bottom),16px)]"
      >
        {steps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            disabled={step.state === "not_reached"}
            aria-current={step.state === "current" ? "step" : undefined}
            onClick={() => onPick(index)}
            className={cn(
              ROW,
              "min-h-14 py-2 disabled:opacity-60",
              step.state === "current" && "bg-foreground/[0.06]"
            )}
          >
            <Glyph index={index} state={step.state} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[0.9375rem] leading-[1.35] text-foreground">
                {step.title}
              </span>
              <span className="text-caption text-muted-foreground">
                {step.objective}
              </span>
            </span>
            {step.state !== "not_reached" && (
              <span className="shrink-0 text-caption text-muted-foreground">
                {step.state === "done" ? "Done" : "Now"}
              </span>
            )}
          </button>
        ))}
        {started && onStartOver && (
          <div className="mt-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={onStartOver}
              className={cn(ROW, "h-12 text-[0.9375rem] text-muted-foreground")}
            >
              <span className="grid size-5 shrink-0 place-items-center">
                <RotateCcw className="size-4" aria-hidden />
              </span>
              Start over…
            </button>
          </div>
        )}
      </nav>
    </SheetContent>
  </Sheet>
);

export default BaseStepsSheet;
