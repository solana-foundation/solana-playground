import * as React from "react"
import { cn } from "cn"

/* What a stage says before there is anything on it: what it is for, what
   it needs, and the one thing to do. It sits on the stage's own ground, so
   the pattern shows through. On a phone the actions pin to the foot. */

function StageEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-empty"
      className={cn("mx-auto flex w-full max-w-[36rem] flex-col items-start gap-4 bg-transparent px-6 py-10 text-left", className)}
      {...props}
    />
  )
}

function StageEmptyMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-empty-media"
      className={cn("grid size-11 place-items-center rounded-xl border border-border bg-surface-panel text-muted-foreground [&_svg:not([class*='size-'])]:size-5", className)}
      {...props}
    />
  )
}

function StageEmptyTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="stage-empty-title"
      className={cn("font-heading text-[clamp(1.75rem,2.4vw,2.5rem)] leading-[1.1] font-headline tracking-tight text-foreground", className)}
      {...props}
    />
  )
}

/* The facts that set it up, in the code face: a program, a network, a size */
function StageEmptyMeta({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="stage-empty-meta" className={cn("font-mono text-xs text-muted-foreground", className)} {...props} />
}

function StageEmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="stage-empty-description" className={cn("max-w-prose text-body font-read text-muted-foreground", className)} {...props} />
}

/* One thing to know first, in a Callout or a line of its own */
function StageEmptyNotice({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="stage-empty-notice" className={cn("w-full", className)} {...props} />
}

function StageEmptyActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-empty-actions"
      className={cn(
        "flex flex-wrap items-center gap-2 pt-2 max-md:sticky max-md:bottom-0 max-md:w-full max-md:bg-gradient-to-t max-md:from-background max-md:from-60% max-md:pt-5 max-md:pb-4",
        className
      )}
      {...props}
    />
  )
}

function StageEmptyFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="stage-empty-footer" className={cn("pt-4 text-caption font-read text-subtle", className)} {...props} />
}

export {
  StageEmpty,
  StageEmptyActions,
  StageEmptyDescription,
  StageEmptyFooter,
  StageEmptyMedia,
  StageEmptyMeta,
  StageEmptyNotice,
  StageEmptyTitle,
}
