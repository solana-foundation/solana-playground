import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

function Diff({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="diff"
      className={cn("flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface", className)}
      {...props}
    />
  )
}

function DiffHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="diff-header"
      className={cn("flex items-center gap-2 border-b border-border px-3 py-2", className)}
      {...props}
    />
  )
}

function DiffTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span data-slot="diff-title" className={cn("min-w-0 truncate font-mono text-xs text-muted-foreground", className)} {...props} />
  )
}

/* Lines added and removed, as the header counts them: +2 −1 */
function DiffStat({
  className,
  added = 0,
  removed = 0,
  ...props
}: React.ComponentProps<"span"> & { added?: number; removed?: number }) {
  return (
    <span data-slot="diff-stat" className={cn("ml-auto flex gap-2 text-xs tabular-nums", className)} {...props}>
      <span className="text-success">+{added}</span>
      <span className="text-error">−{removed}</span>
    </span>
  )
}

function DiffContent({ className, ...props }: React.ComponentProps<"pre">) {
  return (
    <pre
      data-slot="diff-content"
      className={cn("overflow-x-auto py-2 font-mono text-[0.8125rem] leading-relaxed", className)}
      {...props}
    />
  )
}

const diffLineVariants = cva("block px-3 before:mr-2 before:inline-block before:w-2 before:select-none", {
  variants: {
    variant: {
      context: "text-muted-foreground before:content-['_']",
      added: "bg-success/10 text-success before:content-['+']",
      removed: "bg-error/10 text-error before:content-['−']",
    },
  },
  defaultVariants: {
    variant: "context",
  },
})

function DiffLine({
  className,
  variant = "context",
  ...props
}: React.ComponentProps<"code"> & VariantProps<typeof diffLineVariants>) {
  return (
    <code
      data-slot="diff-line"
      data-variant={variant}
      className={cn(diffLineVariants({ variant }), className)}
      {...props}
    />
  )
}

function DiffFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="diff-footer" className={cn("flex items-center gap-2 border-t border-border px-3 py-2", className)} {...props} />
  )
}

export { Diff, DiffContent, DiffFooter, DiffHeader, DiffLine, DiffStat, DiffTitle, diffLineVariants }
