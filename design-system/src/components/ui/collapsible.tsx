"use client"

import { ChevronRightIcon } from "lucide-react"
import { cn } from "cn"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  )
}

/* A trigger dressed as a fold heading: bold, muted text that brightens on
   hover and while open, shrink-wrapped, not selectable, with a visible focus
   outline. Pair it with CollapsibleChevron. CollapsibleTrigger stays unstyled
   for any other use. */
function CollapsibleHeading({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-heading"
      className={cn(
        "flex w-fit cursor-pointer items-center gap-1 font-bold text-muted-foreground select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

/* The fold's mark: points right when closed, down when open. Put it inside
   a CollapsibleTrigger. */
function CollapsibleChevron({
  className,
  ...props
}: React.ComponentProps<typeof ChevronRightIcon>) {
  return (
    <ChevronRightIcon
      data-slot="collapsible-chevron"
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 transition-transform duration-200 [[data-state=open]>&]:rotate-90 motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleHeading,
  CollapsibleContent,
  CollapsibleChevron,
}
