import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

import { useIndicator } from "@/hooks/use-indicator"

/* The development loop as one switch: Write, Build, Deploy, Interact. A
   thumb in Solana's two colours slides to the current stage. Each stage
   says how it stands: done, running, failed with a count, or the target
   the lesson is heading for. Built on Tabs, so the arrow keys move along it. */

function Stepper({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="stepper" activationMode="manual" className={cn("flex flex-col", className)} {...props} />
}

function StepperList({
  className,
  compact = false,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { compact?: boolean }) {
  const [ref, box] = useIndicator<HTMLDivElement>('[data-slot="stepper-item"][data-state="active"]', [children, compact])
  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="stepper-list"
      data-compact={compact}
      aria-label="Development loop"
      className={cn(
        "group/stepper-list relative grid w-fit auto-cols-fr grid-flow-col items-center rounded-full border border-border bg-surface-panel p-[3px]",
        className
      )}
      {...props}
    >
      <span
        data-slot="stepper-indicator"
        aria-hidden="true"
        className="pointer-events-none absolute top-[3px] left-0 h-[calc(100%-6px)] rounded-full gradient-stroke shadow-thumb transition-[transform,width] duration-(--duration-thumb) ease-standard motion-reduce:transition-none"
        style={box ? { width: box.width, transform: `translateX(${box.left}px)` } : { opacity: 0 }}
      />
      {children}
    </TabsPrimitive.List>
  )
}

type StepperStatus = "idle" | "done" | "running" | "failed"

function StepperItem({
  className,
  status = "idle",
  errors,
  target = false,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  status?: "idle" | "done" | "running" | "failed"
  /** how many errors a failed stage has */
  errors?: number
  /** the stage a lesson is heading for */
  target?: boolean
}) {
  const label = typeof children === "string" ? children : undefined
  const said = [label, status !== "idle" && status, status === "failed" && errors ? `${errors} errors` : null, target && "target"]
    .filter(Boolean)
    .join(", ")
  return (
    <TabsPrimitive.Trigger
      data-slot="stepper-item"
      data-status={status}
      data-target={target || undefined}
      aria-label={said || undefined}
      className={cn(
        "relative z-10 inline-flex h-[1.625rem] items-center justify-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-act whitespace-nowrap text-muted-foreground transition-colors duration-140 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-foreground",
        className
      )}
      {...props}
    >
      {status === "done" && <Check aria-hidden="true" className="size-3 text-success" strokeWidth={3} />}
      {status === "running" && <StepperDot className="bg-brand-purple animate-pulse-dot motion-reduce:animate-none" />}
      {status === "failed" && <StepperDot className="bg-error" />}
      <span data-slot="stepper-label" className="group-data-[compact=true]/stepper-list:hidden">
        {children}
      </span>
      {label && (
        <span aria-hidden="true" className="hidden group-data-[compact=true]/stepper-list:inline">
          {label.slice(0, 1)}
        </span>
      )}
      {status === "failed" && errors ? (
        <span data-slot="stepper-errors" className="text-error group-data-[compact=true]/stepper-list:hidden">
          {errors} {errors === 1 ? "error" : "errors"}
        </span>
      ) : null}
      {target && <span data-slot="stepper-target" aria-hidden="true" className="size-[5px] rounded-full bg-brand-purple" />}
    </TabsPrimitive.Trigger>
  )
}

function StepperDot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", className)} />
}

function StepperContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="stepper-content" className={cn("outline-none", className)} {...props} />
}

export { Stepper, StepperContent, StepperItem, StepperList }
export type { StepperStatus }
