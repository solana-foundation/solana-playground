import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/* The product's one vocabulary for state: a dot, in words as well where it
   matters. Running pulses; everything else sits still. */
const statusDotVariants = cva("inline-block shrink-0 rounded-full", {
  variants: {
    variant: {
      idle: "bg-subtle",
      success: "bg-success",
      warning: "bg-warning",
      error: "bg-error",
      info: "bg-info",
      running: "bg-brand-purple animate-pulse-dot motion-reduce:animate-none",
      target: "bg-brand-purple",
    },
    size: {
      sm: "size-[5px]",
      default: "size-1.5",
      lg: "size-[7px]",
    },
  },
  defaultVariants: {
    variant: "idle",
    size: "default",
  },
})

function StatusDot({
  className,
  variant = "idle",
  size = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusDotVariants>) {
  return (
    <span
      data-slot="status-dot"
      data-variant={variant}
      data-size={size}
      aria-hidden="true"
      className={cn(statusDotVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { StatusDot, statusDotVariants }
