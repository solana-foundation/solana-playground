import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "cn"

/* A lesson's band over the stage: how far along, what to do now, and the
   way on. Frosted, so the work shows through it. On a phone it folds to one
   row and its actions move to the bar at the foot. */

function ObjectiveBand({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="objective-band"
      className={cn("frosted flex min-h-10 w-full items-center gap-3 border-b border-border px-3 py-1.5", className)}
      {...props}
    />
  )
}

/* Progress as a short line in Solana's two colours, filled from the left */
function ObjectiveMeter({ className, value, ...props }: React.ComponentProps<"div"> & { value: number }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div
      data-slot="objective-meter"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label="Lesson progress"
      className={cn("h-0.5 w-9 shrink-0 overflow-hidden rounded-full bg-border", className)}
      {...props}
    >
      <div
        className="h-full origin-left bg-gradient-product-flat transition-transform duration-400 ease-standard motion-reduce:transition-none"
        style={{ transform: `scaleX(${v})` }}
      />
    </div>
  )
}

function ObjectiveText({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="objective-text" className={cn("min-w-0 flex-1 truncate font-heading text-sm text-foreground", className)} {...props} />
}

/* Back and on, a step at a time */
function ObjectiveNav({
  className,
  onBack,
  onNext,
  canBack = true,
  canNext = true,
  ...props
}: React.ComponentProps<"div"> & { onBack?: () => void; onNext?: () => void; canBack?: boolean; canNext?: boolean }) {
  const button =
    "grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
  return (
    <div data-slot="objective-nav" className={cn("flex items-center", className)} {...props}>
      <button type="button" aria-label="Previous step" className={button} onClick={onBack} disabled={!canBack}>
        <ChevronLeft className="size-3.5" />
      </button>
      <button type="button" aria-label="Next step" className={button} onClick={onNext} disabled={!canNext}>
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  )
}

function ObjectiveActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="objective-actions" className={cn("ml-auto flex shrink-0 items-center gap-2 max-md:hidden", className)} {...props} />
}

export { ObjectiveActions, ObjectiveBand, ObjectiveMeter, ObjectiveNav, ObjectiveText }
