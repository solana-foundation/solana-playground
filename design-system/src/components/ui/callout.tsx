import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

/* A note inside a page or a form: a tint and a hairline, calm enough to read
   past. Alert is for the page as a whole; a callout is for the place it sits. */
const calloutVariants = cva(
  "group/callout relative grid w-full gap-0.5 rounded-xl border px-3.5 py-3 text-left text-sm has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-border bg-surface-panel text-foreground *:[svg]:text-muted-foreground",
        info: "border-brand-purple/25 bg-brand-purple/[0.07] text-foreground *:[svg]:text-brand-purple",
        warning: "border-warning/20 bg-warning/[0.07] text-warning-ink *:[svg]:text-warning",
        success: "border-success/20 bg-success/[0.07] text-foreground *:[svg]:text-success",
        error: "border-error/25 bg-error/[0.07] text-foreground *:[svg]:text-error",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Callout({ className, variant = "default", ...props }: React.ComponentProps<"div"> & VariantProps<typeof calloutVariants>) {
  return (
    <div
      data-slot="callout"
      data-variant={variant}
      role={variant === "error" || variant === "warning" ? "alert" : "note"}
      className={cn(calloutVariants({ variant }), className)}
      {...props}
    />
  )
}

function CalloutTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="callout-title" className={cn("font-act group-has-[>svg]/callout:col-start-2", className)} {...props} />
}

function CalloutDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="callout-description"
      className={cn("font-read text-pretty opacity-90 group-has-[>[data-slot=callout-actions]]/callout:opacity-100 group-has-[>svg]/callout:col-start-2 [&_a]:underline [&_a]:underline-offset-3", className)}
      {...props}
    />
  )
}

/* The callout's ways out, in one row under its words */
function CalloutActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="callout-actions" className={cn("mt-2 flex flex-wrap items-center gap-2 group-has-[>svg]/callout:col-start-2", className)} {...props} />
}

/* An action inside a callout. An opaque grey button would sit on the tint like
   a patch cut from another layer, so its fill is the callout's own tone, a step
   denser than the callout, enough to read as a button. No edge: the callout's
   hairline is the one outline in the block. Two or more in a row read by
   their order, the first the way out the callout expects. Thumb sized on a
   phone. `asChild` lends the look to another button, an AsyncButton that
   waits on its click. */
function CalloutAction({ className, asChild = false, ...props }: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      type={asChild ? undefined : "button"}
      data-slot="callout-action"
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-foreground/[0.08] px-3 text-[0.8rem] font-act whitespace-nowrap text-current transition-colors outline-none hover:bg-foreground/[0.14] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 max-md:h-11 max-md:text-sm [&_svg]:size-3.5 group-data-[variant=info]/callout:bg-brand-purple/15 group-data-[variant=info]/callout:hover:bg-brand-purple/25 group-data-[variant=warning]/callout:bg-warning/15 group-data-[variant=warning]/callout:hover:bg-warning/25 group-data-[variant=success]/callout:bg-success/15 group-data-[variant=success]/callout:hover:bg-success/25 group-data-[variant=error]/callout:bg-error/15 group-data-[variant=error]/callout:hover:bg-error/25",
        className
      )}
      {...props}
    />
  )
}

export { Callout, CalloutAction, CalloutActions, CalloutDescription, CalloutTitle, calloutVariants }
