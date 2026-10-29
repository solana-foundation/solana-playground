import * as React from "react"
import { cn } from "@/lib/utils"

/* A lesson's steps as a line down the side: done ones ticked and joined in
   green, a skipped one dashed and marked with an arrow, the current one a
   purple dot with a halo, the rest waiting. Each title is read in full,
   wrapping as it needs. On a phone the rows grow to a thumb's size and the
   titles are read at 16px. */

function StepRail({ className, ...props }: React.ComponentProps<"ol">) {
  return <ol data-slot="step-rail" className={cn("flex flex-col p-2 max-md:px-2 max-md:py-3", className)} {...props} />
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
        "group/step-rail-item relative grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 px-2 py-1.5 max-md:gap-x-3.5 max-md:px-3 max-md:py-2.5",
        /* the connector, from this mark down to the next, with air either side */
        "before:absolute before:top-[25px] before:bottom-[-7px] before:left-[15.5px] before:w-px before:bg-border last:before:hidden max-md:before:top-[31px] max-md:before:bottom-[-13px] max-md:before:left-[19.5px]",
        "data-[status=done]:before:bg-success",
        "data-[status=skipped]:opacity-70 data-[status=skipped]:before:bg-[repeating-linear-gradient(to_bottom,var(--border)_0_3px,transparent_3px_6px)]",
        "data-[status=locked]:opacity-50",
        className
      )}
      {...props}
    />
  )
}

const markSvg = "hidden size-3 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]"

/* The mark sits on the title's first line: a 20px box, 24px on a phone */
function StepRailIndicator({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="step-rail-indicator"
      aria-hidden="true"
      className={cn("row-span-2 flex h-5 items-center justify-center self-start max-md:h-6", className)}
      {...props}
    >
      <svg viewBox="0 0 12 12" className={cn(markSvg, "text-success group-data-[status=done]/step-rail-item:block")}>
        <path d="M2.6 6.3l2.2 2.2 4.6-4.9" />
      </svg>
      <svg viewBox="0 0 12 12" className={cn(markSvg, "text-muted-foreground group-data-[status=skipped]/step-rail-item:block")}>
        <path d="M2.5 6h7M6.75 3.25L9.5 6 6.75 8.75" />
      </svg>
      <span className="hidden size-2 rounded-full bg-brand-purple ring-3 ring-brand-purple/25 group-data-[status=current]/step-rail-item:block" />
      <span className="hidden size-2 rounded-full border border-muted-foreground group-data-[status=locked]/step-rail-item:block" />
    </span>
  )
}

function StepRailTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="step-rail-title"
      className={cn(
        "min-w-0 text-[0.8125rem] leading-5 font-read text-muted-foreground max-md:text-body max-md:leading-6",
        "group-data-[status=current]/step-rail-item:font-act group-data-[status=current]/step-rail-item:text-foreground group-data-[status=done]/step-rail-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function StepRailMeta({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="step-rail-meta"
      className={cn("col-start-2 text-xs leading-4 text-muted-foreground max-md:mt-0.5 max-md:text-caption max-md:font-label", className)}
      {...props}
    />
  )
}

export { StepRail, StepRailIndicator, StepRailItem, StepRailMeta, StepRailTitle }
