import * as React from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { BrandButton } from "@/components/ui/brand-button"

/* A lesson's band over the stage: how far along, what to do now, and the
   way on. Frosted, so the work shows through it, and ruled off by a hairline
   rather than boxed. One row: it wraps only when it has to, and then the
   actions drop under the ask as one group. On a phone it folds to
   ObjectiveFold and its actions move to ObjectiveBar at the foot. */

function ObjectiveBand({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="objective-band"
      className={cn("frosted flex w-full shrink-0 flex-col border-b border-border", className)}
      {...props}
    />
  )
}

function ObjectiveRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="objective-row"
      className={cn("flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-[5px]", className)}
      {...props}
    />
  )
}

/* Where you are and the ask, which keeps the row's room before the actions.
   The prototype's basis is 18rem; 14rem keeps one row in the lesson's
   column at 834, where the prototype clipped (Slava, 2026-10-26). */
function ObjectiveMain({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="objective-main"
      className={cn("flex min-w-0 flex-[1_1_14rem] items-center gap-2.5", className)}
      {...props}
    />
  )
}

function ObjectiveCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="objective-count"
      className={cn("shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums", className)}
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
  return (
    <p
      data-slot="objective-text"
      className={cn("min-w-0 truncate font-heading text-sm font-medium text-foreground", className)}
      {...props}
    />
  )
}

/* How the step is checked, one press away: a round check that turns green
   while the condition shows under the row */
function ObjectiveCheck({
  className,
  open,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & { open: boolean }) {
  return (
    <button
      type="button"
      data-slot="objective-check"
      aria-expanded={open}
      aria-label="How this step is checked"
      data-state={open ? "open" : "closed"}
      className={cn(
        "grid size-[22px] shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-success",
        className
      )}
      {...props}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.4]"
      >
        <circle cx="8" cy="8" r="6.25" />
        <path d="M5.4 8.2l1.8 1.8 3.4-3.7" />
      </svg>
    </button>
  )
}

/* The condition the check opens, one line under the row */
function ObjectiveCondition({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="objective-condition"
      className={cn("-mt-0.5 px-3.5 pb-2 text-xs leading-normal text-muted-foreground", className)}
      {...props}
    />
  )
}

/* Back and on, a step at a time: bare chevrons, since they move between
   steps rather than act on one. `phone` is the foot bar's thumb size. */
function ObjectiveNav({
  className,
  onBack,
  onNext,
  canBack = true,
  canNext = true,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & {
  onBack?: () => void
  onNext?: () => void
  canBack?: boolean
  canNext?: boolean
  size?: "default" | "phone"
}) {
  const button = cn(
    "grid place-items-center rounded-full text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35",
    size === "phone" ? "size-12 [&_svg]:size-5" : "size-6 [&_svg]:size-3.5"
  )
  return (
    <div data-slot="objective-nav" data-size={size} className={cn("flex items-center gap-1", className)} {...props}>
      <button type="button" aria-label="Previous step" className={button} onClick={onBack} disabled={!canBack}>
        <ChevronLeft />
      </button>
      <button type="button" aria-label="Next step" className={button} onClick={onNext} disabled={!canNext}>
        <ChevronRight />
      </button>
    </div>
  )
}

function ObjectiveActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="objective-actions"
      className={cn("ml-auto flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  )
}

/* A quiet pill for the page: muted text that lights on hover */
function ObjectiveQuiet({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"button"> & { size?: "default" | "phone" }) {
  return (
    <button
      type="button"
      data-slot="objective-quiet"
      data-size={size}
      className={cn(
        "inline-flex items-center rounded-full whitespace-nowrap text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        size === "phone" ? "h-12 px-4 text-[0.9375rem] font-act" : "ml-1 h-[1.625rem] px-2.5 text-[0.8125rem]",
        className
      )}
      {...props}
    />
  )
}

/* The step's one clear action: the brand ring, small */
function ObjectivePrimary({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<typeof BrandButton>, "size" | "variant"> & { size?: "default" | "phone" }) {
  return (
    <BrandButton
      size="sm"
      data-slot="objective-primary"
      className={cn(
        size === "phone" ? "h-12 px-5 text-[0.9375rem] font-act" : "ml-1 text-[0.8125rem] font-medium",
        className
      )}
      {...props}
    />
  )
}

/* A phone's band: one row, a pane's head in height, that opens in place to
   show the whole ask and how it is checked */
function ObjectiveFold({
  className,
  open,
  position,
  value,
  objective,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  open: boolean
  /** "1/4" */
  position: string
  value: number
  objective: string
  /** What shows under the row while open */
  children?: React.ReactNode
}) {
  return (
    <div data-slot="objective-fold" data-state={open ? "open" : "closed"} className="frosted border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        className={cn(
          "flex min-h-13 w-full items-center gap-3 pr-3 pl-5 text-left text-foreground outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-surface-hover",
          className
        )}
        {...props}
      >
        <span className="flex shrink-0 flex-col gap-1 text-[0.8125rem] font-label text-muted-foreground tabular-nums">
          {position}
          <ObjectiveMeter value={value} className="w-7" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 text-[0.9375rem] font-act",
            open ? "py-3" : "truncate"
          )}
        >
          {objective}
        </span>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.6}
          className={cn(
            "size-5 shrink-0 text-muted-foreground transition-transform duration-200 ease-standard motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2 pr-2 pb-2.5 pl-5">
          <p className="pr-3 text-[0.9375rem] font-read text-muted-foreground">{children}</p>
        </div>
      )}
    </div>
  )
}

/* The foot of the code on a phone, under the thumb: back and on at the
   start, the page and the step's action at the end */
function ObjectiveBar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="toolbar"
      aria-label="This step"
      data-slot="objective-bar"
      className={cn(
        "frosted flex min-h-[calc(3.75rem+env(safe-area-inset-bottom,0px))] shrink-0 items-center gap-1 border-t border-border pr-2 pb-[env(safe-area-inset-bottom,0px)] pl-1.5",
        className
      )}
      {...props}
    />
  )
}

export {
  ObjectiveActions,
  ObjectiveBand,
  ObjectiveBar,
  ObjectiveCheck,
  ObjectiveCondition,
  ObjectiveCount,
  ObjectiveFold,
  ObjectiveMain,
  ObjectiveMeter,
  ObjectiveNav,
  ObjectivePrimary,
  ObjectiveQuiet,
  ObjectiveRow,
  ObjectiveText,
}
