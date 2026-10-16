import * as React from "react"
import { Check, ChevronDown, X } from "lucide-react"
import { cn } from "cn"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

/* "Get set up · 2 of 4": the few things a new workspace needs, in the
   sidebar, folded when you want it out of the way and gone once every step
   is done. */

function SetupList({ className, ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="setup-list" className={cn("group/setup-list flex flex-col", className)} {...props} />
}

function SetupListHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="setup-list-header" className={cn("group/setup-list-header flex items-center gap-1", className)} {...props} />
}

function SetupListTrigger({
  className,
  children,
  done,
  total,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger> & { done?: number; total?: number }) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="setup-list-trigger"
      className={cn(
        "flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-[0.8125rem] font-act text-foreground outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      {total ? (
        <span className="text-muted-foreground tabular-nums">
          · {done ?? 0} of {total}
        </span>
      ) : null}
      <ChevronDown className="ml-auto size-3.5 text-muted-foreground transition-transform duration-150 group-data-[state=closed]/setup-list:-rotate-90" />
    </CollapsiblePrimitive.Trigger>
  )
}

/* Shows on hover, and always on a touch screen */
function SetupListDismiss({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="setup-list-dismiss"
      aria-label="Dismiss the checklist"
      className={cn(
        "grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity outline-none group-hover/setup-list-header:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100",
        className
      )}
      {...props}
    >
      <X className="size-3.5" />
    </button>
  )
}

function SetupListContent({ className, children, ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content data-slot="setup-list-content" asChild {...props}>
      <ul className={cn("mt-0.5 flex flex-col", className)}>{children}</ul>
    </CollapsiblePrimitive.Content>
  )
}

function SetupListItem({
  className,
  status = "todo",
  ...props
}: React.ComponentProps<"li"> & { status?: "todo" | "done" | "warn" }) {
  return (
    <li
      data-slot="setup-list-item"
      data-status={status}
      className={cn(
        "group/setup-item flex h-8 items-center gap-2.5 rounded-md px-2 text-[0.8125rem] text-muted-foreground data-[status=done]:text-subtle",
        className
      )}
      {...props}
    />
  )
}

/* A ring to do, Solana's green with a tick once done, red when it needs you */
function SetupListIndicator({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="setup-list-indicator"
      aria-hidden="true"
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-full border-[1.5px] border-subtle group-data-[status=done]/setup-item:border-success group-data-[status=done]/setup-item:bg-success group-data-[status=warn]/setup-item:border-error",
        className
      )}
      {...props}
    >
      <Check className="hidden size-2.5 text-[#151515] group-data-[status=done]/setup-item:block" strokeWidth={3.5} />
    </span>
  )
}

function SetupListLabel({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="setup-list-label" className={cn("min-w-0 flex-1 truncate group-data-[status=todo]/setup-item:text-foreground", className)} {...props} />
}

/* What sits at the right: a value, an action, an arrow */
function SetupListValue({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="setup-list-value"
      className={cn("ml-auto shrink-0 text-xs text-muted-foreground group-data-[status=warn]/setup-item:text-error [&_svg]:size-3.5", className)}
      {...props}
    />
  )
}

export {
  SetupList,
  SetupListContent,
  SetupListDismiss,
  SetupListHeader,
  SetupListIndicator,
  SetupListItem,
  SetupListLabel,
  SetupListTrigger,
  SetupListValue,
}
