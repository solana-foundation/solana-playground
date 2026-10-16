import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

/* A tinted label that sorts a thing: its level, its framework, its language.
   Badge says a state; a tag says a kind. */
const tagVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] font-act tracking-[0.06em] whitespace-nowrap uppercase [&>svg]:size-3 [&>img]:size-3.5 [&>img]:rounded-sm",
  {
    variants: {
      variant: {
        neutral: "bg-surface-raised text-muted-foreground",
        success: "bg-success/12 text-success",
        warning: "bg-warning/12 text-warning",
        info: "bg-info/12 text-info",
        error: "bg-error/12 text-error",
        brand: "bg-brand-purple/14 text-[#c9a6ff]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Tag({
  className,
  variant = "neutral",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof tagVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"
  return <Comp data-slot="tag" data-variant={variant} className={cn(tagVariants({ variant }), className)} {...props} />
}

/* A tutorial's level, in the colours client-v2 already uses for it */
const LEVEL_VARIANT = { beginner: "success", intermediate: "warning", advanced: "info" } as const

function levelVariant(level: string): VariantProps<typeof tagVariants>["variant"] {
  return LEVEL_VARIANT[level.toLowerCase() as keyof typeof LEVEL_VARIANT] ?? "error"
}

export { levelVariant, Tag, tagVariants }
