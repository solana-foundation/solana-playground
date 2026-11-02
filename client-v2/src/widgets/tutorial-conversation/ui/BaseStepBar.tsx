import { Check, ChevronDown } from "lucide-react";

import type { StepJumpVia } from "@/entities/tutorial";
import type { StepBarItem } from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/** The ways the bar itself jumps; the feed adds the keys */
export type JumpVia = Exclude<StepJumpVia, "key">;

export interface BaseStepBarProps {
  steps: readonly StepBarItem[];
  /**
   * The live step's index, which must be `liveStepIndex(steps)`: the current
   * one, or the last passed after the finish; null before Start. The feed
   * passes it, so the bar and the feed agree on one live step.
   */
  live: number | null;
  /** The step the feed is scrolled into, by index, when it is not the live one */
  viewing: number | null;
  /** How far the hairline reaches, from 0 to 1 (`barProgress`) */
  progress: number;
  /** Under 24rem of chat width the bar is one button that opens a menu */
  narrow: boolean;
  /** A done or current step was picked, by its index */
  onJump: (index: number, via: JumpVia) => void;
}

const labelOf = (step: StepBarItem, index: number, count: number) => {
  const where = `Step ${index + 1} of ${count}, ${step.title}`;
  if (step.state === "done") return `${where}, done`;
  if (step.state === "current") return `${where}, current`;
  return where;
};

const currentOf = (looking: boolean, isLive: boolean) => {
  if (looking) return "location" as const;
  return isLive ? ("step" as const) : undefined;
};

/** The glyph a segment and a menu row start with: the number, or a check once done */
const Glyph = ({ step, index }: { step: StepBarItem; index: number }) => (
  <span
    aria-hidden="true"
    className={cn(
      "grid size-4 shrink-0 place-items-center rounded-full text-[0.625rem] font-act tabular-nums",
      step.state === "done" && "bg-brand-green text-brand-ink",
      step.state === "current" && "bg-brand-purple text-white",
      step.state === "not_reached" &&
        "border-[1.5px] border-border-strong text-subtle"
    )}
  >
    {step.state === "done" ? (
      <Check className="size-2.5" strokeWidth={3} />
    ) : (
      index + 1
    )}
  </span>
);

/**
 * The segments are raw `button`s: a step segment, its glyph and its
 * connector are the prototype's, and neither of the design system's step
 * parts fits: `step-rail` is the v1 lesson's vertical rail, and `stepper` is
 * a Tabs switch with one selection (the Write, Build, Deploy loop), where
 * these are jump buttons marked with `aria-current`.
 *
 * The tutorial's steps under the chat head: one button per step, labelled
 * with its short label, and the progress hairline on the bar's bottom edge.
 * A step not reached is disabled; the live one is `aria-current="step"`, and
 * the one the feed is scrolled into, when it is another, is
 * `aria-current="location"`. Narrow, the bar is one button, "Step n of m ·
 * <short>" ("m steps" before Start), whose menu lists the steps with Done
 * and Now.
 */
const BaseStepBar = ({
  steps,
  live,
  viewing,
  progress,
  narrow,
  onJump,
}: BaseStepBarProps) => {
  const count = steps.length;
  const hairline = (
    <span
      aria-hidden="true"
      data-testid="step-bar-progress"
      style={{ width: `${Math.round(progress * 1000) / 10}%` }}
      className="absolute bottom-[-1px] left-0 h-0.5 rounded-r-full bg-gradient-product-flat transition-[width] duration-(--duration-slow) ease-out motion-reduce:transition-none"
    />
  );

  if (narrow) {
    const at = live === null ? null : steps[live];
    return (
      <nav
        aria-label="Tutorial steps"
        className="relative flex h-10 shrink-0 items-center border-b border-border px-3"
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!steps.some((s) => s.state !== "not_reached")}
            className="flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[0.8125rem] font-label outline-none hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand-purple disabled:hover:bg-transparent"
          >
            {at && live !== null ? (
              <>
                <span className="text-muted-foreground tabular-nums">
                  Step {live + 1} of {count}
                </span>
                <span aria-hidden="true" className="text-subtle">
                  ·
                </span>
                <span className="text-foreground">{at.short}</span>
              </>
            ) : (
              <span className="text-muted-foreground tabular-nums">
                {count} steps
              </span>
            )}
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {steps.map((step, index) => (
              <DropdownMenuItem
                key={step.id}
                disabled={step.state === "not_reached"}
                aria-current={currentOf(viewing === index, live === index)}
                onSelect={() => onJump(index, "menu")}
                className="min-h-10 gap-3 px-2.5"
              >
                <Glyph step={step} index={index} />
                <span className="min-w-0 flex-1 truncate">{step.title}</span>
                {step.state !== "not_reached" && (
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {step.state === "done" ? "Done" : "Now"}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {hairline}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Tutorial steps"
      className="relative flex h-10 shrink-0 items-center border-b border-border px-3"
    >
      {steps.map((step, index) => (
        <span key={step.id} className="flex min-w-0 flex-1 items-center">
          {index > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                "mx-1 h-px min-w-2 max-w-6 flex-1",
                steps[index - 1].state === "done"
                  ? "bg-border-strong"
                  : "bg-border"
              )}
            />
          )}
          <button
            type="button"
            disabled={step.state === "not_reached"}
            aria-label={labelOf(step, index, count)}
            aria-current={currentOf(viewing === index, live === index)}
            onClick={() => onJump(index, "bar")}
            className={cn(
              "flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] px-2 text-[0.8125rem] font-label outline-none focus-visible:outline-2 focus-visible:outline-brand-purple disabled:cursor-default",
              step.state === "not_reached" && "text-subtle",
              step.state === "current" &&
                "text-foreground hover:bg-surface-hover",
              step.state === "done" &&
                "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              viewing === index &&
                "bg-surface-raised text-foreground ring-1 ring-inset ring-border-strong"
            )}
          >
            <Glyph step={step} index={index} />
            <span className="truncate">{step.short}</span>
          </button>
        </span>
      ))}
      {hairline}
    </nav>
  );
};

export default BaseStepBar;
