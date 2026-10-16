import * as React from "react"
import { cn } from "cn"

function CodeBlock({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block"
      className={cn(
        "group/code-block flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-base",
        className
      )}
      {...props}
    />
  )
}

function CodeBlockHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={cn("flex h-9 items-center gap-2 border-b border-border pr-1.5 pl-3", className)}
      {...props}
    />
  )
}

function CodeBlockTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="code-block-title"
      className={cn("min-w-0 truncate font-mono text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function CodeBlockActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-actions"
      className={cn(
        "ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/code-block:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function CodeBlockContent({ className, ...props }: React.ComponentProps<"pre">) {
  return (
    <pre
      data-slot="code-block-content"
      className={cn(
        "overflow-x-auto p-3 font-mono text-[0.8125rem] leading-relaxed text-syntax-plain [counter-reset:line]",
        className
      )}
      {...props}
    />
  )
}

/* One line. Numbered by CSS, so copying the code leaves the numbers behind */
function CodeBlockLine({ className, ...props }: React.ComponentProps<"code">) {
  return (
    <code
      data-slot="code-block-line"
      className={cn(
        "block min-h-[1lh] [counter-increment:line] before:mr-4 before:inline-block before:w-5 before:text-right before:text-subtle before:content-[counter(line)] before:select-none",
        className
      )}
      {...props}
    />
  )
}

export { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle }
