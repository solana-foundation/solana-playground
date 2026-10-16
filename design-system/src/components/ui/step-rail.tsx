import * as React from "react"
import { Check, CornerDownRight } from "lucide-react"
import { cn } from "cn"

/* A lesson's steps as a line down the side: done ones ticked and joined in
   green, a skipped one dashed, the current one a purple dot with a halo,
   the rest waiting. The rows say where you are; they are not a way to jump. */

function StepRail({ className, ...props }: React.ComponentProps<"ol">) {
  return <ol data-slot="step-rail" className={cn("flex flex-col gap-[3px]", className)} {...props} />
}

function StepRailItem({
  className,
  status = "locked",
  ...props
}: React.ComponentProps<"li"> & { status?: "done" | "skipped" | "current" | "locked" }) {
  return (
    <li
      data-slot="step-rail-item"
      data-status={status}
      aria-current={status === "current" ? "step" : undefined}
      className={cn(
        "group/step-rail-item relative grid grid-cols-[20px_1fr] gap-x-2.5 py-1.5",
        /* the connector, from this mark down to the next */
        "before:absolute before:top-[26px] before:bottom-[-9px] before:left-[9.5px] before:w-px before:bg-border last:before:hidden",
        "data-[status=done]:before:bg-success/60",
        "data-[status=skipped]:opacity-70 data-[status=skipped]:before:bg-[repeating-linear-gradient(to_bottom,var(--border)_0_3px,transparent_3px_6px)]",
        "data-[status=locked]:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function StepRailIndicator({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="step-rail-indicator"
      aria-hidden="true"
      className={cn("row-span-2 grid size-5 place-items-center", className)}
      {...props}
    >
      <Check className="hidden size-3 text-success group-data-[status=done]/step-rail-item:block" strokeWidth={3} />
      <CornerDownRight className="hidden size-3 text-muted-foreground group-data-[status=skipped]/step-rail-item:block" />
      <span className="hidden size-2 rounded-full bg-brand-purple ring-3 ring-brand-purple/25 group-data-[status=current]/step-rail-item:block" />
      <span className="hidden size-2 rounded-full border border-subtle group-data-[status=locked]/step-rail-item:block" />
    </span>
  )
}

function StepRailTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="step-rail-title"
      className={cn(
        "min-w-0 truncate text-[0.8125rem] leading-5 text-muted-foreground group-data-[status=current]/step-rail-item:font-act group-data-[status=current]/step-rail-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function StepRailMeta({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="step-rail-meta" className={cn("col-start-2 text-xs text-subtle", className)} {...props} />
}

export { StepRail, StepRailIndicator, StepRailItem, StepRailMeta, StepRailTitle }
