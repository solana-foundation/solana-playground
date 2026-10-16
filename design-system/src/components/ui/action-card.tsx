import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

/* A card you open: a tutorial, a sample, a program. The link inside it
   covers the whole card, so the card is one target and the text stays
   selectable. default takes a brighter edge on hover. frame is the older
   card's: a ring of the brand's colours fades in and the card lifts. */

const actionCardVariants = cva(
  "group/action-card relative flex min-w-0 gap-3 rounded-xl border border-border bg-surface-panel p-3.5 transition-[border-color,transform,background-color] duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
  {
    variants: {
      variant: {
        default: "hover:border-muted-foreground",
        frame:
          "after:pointer-events-none after:absolute after:-inset-[5px] after:-z-10 after:rounded-[18px] after:bg-[linear-gradient(45deg,var(--brand-purple),var(--brand-green))] after:opacity-0 after:transition-opacity after:duration-150 hover:-translate-y-2 hover:bg-surface-hover hover:after:opacity-100 motion-reduce:hover:translate-y-0",
      },
      orientation: {
        horizontal: "flex-row items-start",
        vertical: "flex-col",
      },
    },
    defaultVariants: {
      variant: "default",
      orientation: "horizontal",
    },
  }
)

function ActionCard({
  className,
  variant = "default",
  orientation = "horizontal",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof actionCardVariants>) {
  return (
    <div
      data-slot="action-card"
      data-variant={variant}
      data-orientation={orientation}
      className={cn(actionCardVariants({ variant, orientation }), variant === "frame" && "isolate", className)}
      {...props}
    />
  )
}

function ActionCardMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & { variant?: "icon" | "image" }) {
  return (
    <div
      data-slot="action-card-media"
      data-variant={variant}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-raised text-muted-foreground",
        variant === "icon" && "size-11 [&_svg:not([class*='size-'])]:size-5",
        variant === "image" && "h-[2.625rem] w-14 *:size-full *:object-cover",
        className
      )}
      {...props}
    />
  )
}

function ActionCardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="action-card-content" className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)} {...props} />
}

function ActionCardEyebrow({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="action-card-eyebrow" className={cn("text-xs text-subtle", className)} {...props} />
}

function ActionCardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 data-slot="action-card-title" className={cn("line-clamp-1 text-control font-act text-foreground", className)} {...props} />
}

function ActionCardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="action-card-description" className={cn("line-clamp-2 text-caption font-read text-muted-foreground", className)} {...props} />
}

/* The link, stretched over the card. Put it in the title */
function ActionCardLink({ className, asChild = false, ...props }: React.ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a"
  return (
    <Comp
      data-slot="action-card-link"
      className={cn("outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']", className)}
      {...props}
    />
  )
}

/* An action of its own, above the stretched link. Hidden on a phone,
   where the whole card is the action */
function ActionCardAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="action-card-action" className={cn("relative z-10 ml-auto shrink-0 self-center max-md:hidden", className)} {...props} />
}

export {
  ActionCard,
  ActionCardAction,
  ActionCardContent,
  ActionCardDescription,
  ActionCardEyebrow,
  ActionCardLink,
  ActionCardMedia,
  ActionCardTitle,
  actionCardVariants,
}
