import * as React from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "cn"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

/* What client-v2's four menus do that shadcn's menus leave out, as parts to
   put inside them: an item with a line under its name, a note that is not
   an item, and rows that fold open in place instead of flying out.
   They go inside DropdownMenu and ContextMenu as they are. */

/* A name, and a line under it that says what it does */
function MenuItemText({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="menu-item-text" className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)} {...props} />
}

function MenuItemDescription({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="menu-item-description" className={cn("line-clamp-2 text-xs font-read text-muted-foreground", className)} {...props} />
}

/* A line of help at the foot of a menu. Not focusable, not an item */
function MenuNote({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="menu-note" role="note" className={cn("px-2 py-1.5 text-xs font-read text-muted-foreground", className)} {...props} />
}

function MenuFold({ className, ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="menu-fold" className={cn("group/menu-fold", className)} {...props} />
}

/* Wrap a menu item in it, and stop that item closing the menu:
   <MenuFoldTrigger asChild><DropdownMenuItem onSelect={(e) => e.preventDefault()}>… */
function MenuFoldTrigger(props: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return <CollapsiblePrimitive.Trigger data-slot="menu-fold-trigger" {...props} />
}

function MenuFoldChevron({ className, ...props }: React.ComponentProps<typeof ChevronRight>) {
  return (
    <ChevronRight
      data-slot="menu-fold-chevron"
      aria-hidden="true"
      className={cn("ml-auto size-3.5 text-muted-foreground transition-transform duration-140 group-data-[state=open]/menu-fold:rotate-90", className)}
      {...props}
    />
  )
}

function MenuFoldContent({ className, ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return <CollapsiblePrimitive.Content data-slot="menu-fold-content" className={cn("pl-[1.375rem]", className)} {...props} />
}

export { MenuFold, MenuFoldChevron, MenuFoldContent, MenuFoldTrigger, MenuItemDescription, MenuItemText, MenuNote }
