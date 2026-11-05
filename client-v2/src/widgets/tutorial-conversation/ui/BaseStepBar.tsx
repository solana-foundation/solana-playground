/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { Check, ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import type { StepJumpVia } from "@/entities/tutorial";
import type { StepBarItem } from "@/features/tutorial-conversation";
import { COARSE_HIT_BELOW, COARSE_HIT_ROW } from "@/shared/lib/hit-area";
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
  /** A done or current step was picked, by its index */
  onJump: (index: number, via: JumpVia) => void;
}

const FOCUS =
  "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-purple";

/** The newly lit segments sweep in one after another */
const SWEEP_AFTER = 140;
const SWEEP_STAGGER = 180;

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

/** What the trigger says: the count before Start, the step, or the finish */
const whereOf = (count: number, live: number | null, finished: boolean) => {
  if (live === null) return `${count} steps`;
  if (finished) return `Done · ${count} of ${count}`;
  return `Step ${live + 1} of ${count}`;
};

/**
 * One gradient laid across all the segments: each shows its own share, so
 * the gaps break a single bar instead of a colour a step. A percent position
 * moves an image n boxes wide by one box per n - 1
 */
const shareOf = (index: number, count: number): CSSProperties => ({
  backgroundImage: "var(--gradient-product-flat)",
  backgroundSize: `${count * 100}% 100%`,
  backgroundPosition: `${count > 1 ? (index / (count - 1)) * 100 : 0}% 0`,
});

/** Remembers how many segments were lit last time, so only the ones lit since sweep, in order */
const useSweep = (lit: number) => {
  const before = useRef(lit);
  const from = before.current;
  useEffect(() => {
    before.current = lit;
  }, [lit]);
  return (index: number) =>
    index >= from ? SWEEP_AFTER + (index - from) * SWEEP_STAGGER : 0;
};

/** The glyph a menu row starts with: the number, or a check once done */
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
 * The tutorial's steps under the chat head, as the prototype's `StepBar` at
 * `f7d42bf2e` draws them: one line, "Step n of m · <short>" at 14/18, opens
 * the steps' menu (Done and Now, a step not reached disabled), and 8 px under
 * it one segment per step, a 4 px rounded bar on a 12% track, 4 px apart,
 * each a 12 px tall button that jumps to its step. A segment lights whole, in
 * the brand gradient, as its step is entered.
 *
 * Built from the menu and raw buttons: the design system's `stepper` is a
 * Tabs switch with one selection and `step-rail` the v1 vertical rail;
 * these are jump buttons marked with `aria-current`.
 */
const BaseStepBar = ({ steps, live, viewing, onJump }: BaseStepBarProps) => {
  const count = steps.length;
  const finished = count > 0 && steps.every((s) => s.state === "done");
  let lit = 0;
  if (finished) lit = count;
  else if (live !== null) lit = live + 1;
  const delayOf = useSweep(lit);
  const name = live !== null && !finished ? steps[live]?.short : null;

  return (
    <nav aria-label="Tutorial steps" className="shrink-0 px-5 pt-3 pb-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={live === null}
          className={cn(
            COARSE_HIT_ROW,
            "group -mx-1.5 flex h-[1.125rem] items-center gap-1.5 rounded-md px-1.5 text-[0.875rem] leading-[1.125rem] font-label hover:bg-surface-hover disabled:hover:bg-transparent data-[state=open]:bg-surface-hover",
            FOCUS
          )}
        >
          <span className="text-muted-foreground tabular-nums">
            {whereOf(count, live, finished)}
          </span>
          {name && (
            <>
              <span aria-hidden="true" className="text-subtle">
                ·
              </span>
              <span className="font-medium text-foreground">{name}</span>
            </>
          )}
          {live !== null && (
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" alignOffset={-8} className="w-64">
          {steps.map((step, index) => {
            const now = step.state === "current";
            const looking = viewing === index;
            return (
              <DropdownMenuItem
                key={step.id}
                disabled={step.state === "not_reached"}
                aria-current={currentOf(looking, live === index)}
                onSelect={() => onJump(index, "menu")}
                className={cn(
                  "min-h-10 gap-3 px-2.5",
                  (now || looking) && "bg-foreground/[0.06]"
                )}
              >
                <Glyph step={step} index={index} />
                <span className="min-w-0 flex-1 truncate">{step.title}</span>
                {step.state !== "not_reached" && (
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {step.state === "done" ? "Done" : "Now"}
                  </span>
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <span
        className="mt-2 grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
        }}
      >
        {steps.map((step, index) => {
          const on = index < lit;
          return (
            <button
              key={step.id}
              type="button"
              data-step-segment=""
              data-lit={on}
              disabled={step.state === "not_reached"}
              aria-label={labelOf(step, index, count)}
              aria-current={currentOf(viewing === index, live === index)}
              onClick={() => onJump(index, "bar")}
              className={cn(
                // Reaching down only: centred, it covered the trigger's
                // lower half, and a tap there jumped instead of opening
                COARSE_HIT_BELOW,
                "flex h-3 items-center disabled:cursor-default",
                FOCUS
              )}
            >
              <span
                aria-hidden="true"
                className="relative block h-1 w-full overflow-hidden rounded-[4px] bg-foreground/[0.12]"
              >
                <span
                  style={{
                    ...shareOf(index, count),
                    clipPath: on ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
                    transitionDelay: on ? `${delayOf(index)}ms` : "0ms",
                  }}
                  className="absolute inset-0 transition-[clip-path] duration-(--duration-slow) ease-out motion-reduce:transition-none"
                />
              </span>
            </button>
          );
        })}
      </span>
    </nav>
  );
};

export default BaseStepBar;
