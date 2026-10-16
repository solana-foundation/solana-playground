import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

function Terminal({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="terminal"
      role="log"
      aria-live="polite"
      className={cn(
        "flex w-full flex-col gap-0.5 overflow-auto rounded-xl border border-border bg-surface-well p-3 font-mono text-[0.8125rem] leading-relaxed text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

const terminalLineVariants = cva("min-w-0 break-words whitespace-pre-wrap", {
  variants: {
    variant: {
      output: "text-muted-foreground",
      prompt: "text-foreground before:mr-2 before:text-brand-purple before:content-['$']",
      info: "text-info",
      success: "text-success",
      warning: "text-warning",
      error: "text-error",
    },
  },
  defaultVariants: {
    variant: "output",
  },
})

function TerminalLine({
  className,
  variant = "output",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof terminalLineVariants>) {
  return (
    <div
      data-slot="terminal-line"
      data-variant={variant}
      className={cn(terminalLineVariants({ variant }), className)}
      {...props}
    />
  )
}

/* The prompt's block caret, in Solana's green, blinking */
function TerminalCaret({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="terminal-caret"
      aria-hidden="true"
      className={cn("inline-block h-[1.1em] w-[0.6em] translate-y-[0.2em] bg-success animate-caret motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Terminal, TerminalCaret, TerminalLine, terminalLineVariants }
