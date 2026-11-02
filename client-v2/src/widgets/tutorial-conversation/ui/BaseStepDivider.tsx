import { Check } from "lucide-react";

import { formatTook } from "./Prose";

export interface BaseStepDividerProps {
  /** 1-based */
  index: number;
  count: number;
  title: string;
  objective: string;
  done: boolean;
  /** ms, once done */
  took: number | null;
}

/**
 * The head of a step in the feed, and the step bar's target: the kicker
 * "Step n of m", the title and the objective; once the step has passed, a
 * check and the step's time. It never acts.
 */
const BaseStepDivider = ({
  index,
  count,
  title,
  objective,
  done,
  took,
}: BaseStepDividerProps) => (
  <div className="mt-1 flex items-start gap-3 border-t border-border pt-4">
    <div className="min-w-0 flex-1">
      <p className="text-[0.75rem] font-act text-muted-foreground tabular-nums">
        Step {index} of {count}
      </p>
      <h2 className="font-heading text-title text-foreground">{title}</h2>
      <p className="text-caption text-muted-foreground">{objective}</p>
    </div>
    {done && (
      <p className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground tabular-nums">
        <Check
          role="img"
          aria-label="Passed"
          className="size-3.5 text-success"
        />
        {took !== null && formatTook(took)}
      </p>
    )}
  </div>
);

export default BaseStepDivider;
