import * as React from "react";

import { cn } from "@/shared/lib/utils";

/* What a stage says before there is anything on it: what it is for, what
   it needs, and the one thing to do, centred in the stage as the prototype's
   EmptyStage sets it. It sits on the stage's own ground, so the pattern shows
   through. On a phone the actions pin to the foot, the first action last,
   under the thumb, and as wide as the screen. A stage that shows results
   rather than an empty state passes `my-0 items-start text-left`. */

function StageEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-empty"
      className={cn(
        "mx-auto my-auto flex w-full max-w-[36rem] flex-col items-center gap-4 bg-transparent px-7 py-8 text-center",
        className
      )}
      {...props}
    />
  );
}

function StageEmptyMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-empty-media"
      className={cn(
        "grid size-11 place-items-center rounded-xl border border-border bg-surface-panel text-muted-foreground [&_svg:not([class*='size-'])]:size-5",
        className
      )}
      {...props}
    />
  );
}

/* Where the stage acts, above its title: the network a deploy goes to. A
   quiet caption, so the title stays the one heading; a StatusDot may lead
   it. It sits closer to the title than the stage's gap, to read as part of
   it. */
function StageEmptyEyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="stage-empty-eyebrow"
      className={cn(
        "-mb-2 inline-flex items-center gap-1.5 text-caption font-act text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function StageEmptyTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="stage-empty-title"
      className={cn(
        "font-heading text-[clamp(1.75rem,2.4vw,2.5rem)] leading-[1.1] font-headline tracking-tight text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </h2>
  );
}

/* The facts that set it up, in the code face: a program, a network, a size */
function StageEmptyMeta({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="stage-empty-meta"
      className={cn("font-mono text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

/* Balanced, as a centred line of two should be: left to wrap on its own it
   dropped one word onto the second line ("passes.") */
function StageEmptyDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="stage-empty-description"
      className={cn(
        "max-w-[28rem] text-body font-read text-balance text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

/* One thing to know first, in a Callout or a line of its own */
function StageEmptyNotice({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-empty-notice"
      className={cn("w-full", className)}
      {...props}
    />
  );
}

function StageEmptyActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-empty-actions"
      className={cn(
        // A plain button beside the brand pill takes its height and shape,
        // so the pair reads as one row of actions. A rare action is a link
        // under the pill, in the text's colour: the brand stays the pill's.
        "flex flex-wrap items-center justify-center gap-x-2 gap-y-5 pt-3 [&>[data-slot=button]]:h-10 [&>[data-slot=button]]:rounded-full [&>[data-slot=button]]:px-5 [&_[data-variant=link]]:text-foreground max-md:sticky max-md:bottom-0 max-md:w-full max-md:flex-col-reverse max-md:items-stretch max-md:bg-gradient-to-t max-md:from-background max-md:from-60% max-md:pt-5 max-md:pb-4",
        className
      )}
      {...props}
    />
  );
}

function StageEmptyFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-empty-footer"
      className={cn("pt-4 text-caption font-read text-subtle", className)}
      {...props}
    />
  );
}

export {
  StageEmpty,
  StageEmptyActions,
  StageEmptyDescription,
  StageEmptyEyebrow,
  StageEmptyFooter,
  StageEmptyMedia,
  StageEmptyMeta,
  StageEmptyNotice,
  StageEmptyTitle,
};
