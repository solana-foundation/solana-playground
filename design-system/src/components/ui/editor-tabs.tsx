import * as React from "react"
import { XIcon } from "lucide-react"
import { cn } from "cn"

/* The open files over the editor. The current one sits on the editor's own
   ground with a purple line along its top. A tab whose menu is open keeps
   an edge while the menu is up. Dragging to reorder belongs to the app
   (client-v2 uses dnd-kit); this is how a tab looks and what it says. */

function EditorTabs({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="editor-tabs"
      role="tablist"
      aria-label="Open files"
      className={cn("flex h-10 items-stretch overflow-x-auto border-b border-border bg-surface-base [scrollbar-width:none]", className)}
      {...props}
    />
  )
}

const TabContext = React.createContext(false)

function EditorTab({
  className,
  active = false,
  menuOpen = false,
  ...props
}: React.ComponentProps<"div"> & { active?: boolean; menuOpen?: boolean }) {
  return (
    <TabContext.Provider value={active}>
      <div
        data-slot="editor-tab"
        data-active={active || undefined}
        data-menu-open={menuOpen || undefined}
        className={cn(
          "group/editor-tab relative flex shrink-0 items-center gap-1 border-r border-border pr-1.5 pl-3 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground",
          "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary before:opacity-0",
          "data-active:bg-surface data-active:text-foreground data-active:before:opacity-100",
          "data-menu-open:ring-1 data-menu-open:ring-muted-foreground/40 data-menu-open:ring-inset",
          className
        )}
        {...props}
      />
    </TabContext.Provider>
  )
}

function EditorTabTrigger({ className, ...props }: React.ComponentProps<"button">) {
  const active = React.useContext(TabContext)
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-slot="editor-tab-trigger"
      className={cn("flex h-full min-w-0 items-center gap-2 outline-none focus-visible:underline [&_svg]:size-3.5 [&_svg]:shrink-0", className)}
      {...props}
    />
  )
}

function EditorTabLabel({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="editor-tab-label" className={cn("max-w-40 truncate", className)} {...props} />
}

/* Close shows on hover and on the current tab; always on a touch screen */
function EditorTabClose({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="editor-tab-close"
      className={cn(
        "grid size-5 place-items-center rounded text-muted-foreground opacity-0 outline-none group-hover/editor-tab:opacity-100 group-data-active/editor-tab:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100",
        className
      )}
      {...props}
    >
      <XIcon className="size-3" />
    </button>
  )
}

export { EditorTab, EditorTabClose, EditorTabLabel, EditorTabs, EditorTabTrigger }
