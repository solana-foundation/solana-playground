import * as React from "react"
import { ChevronUp } from "lucide-react"
import { cn } from "cn"

/* The console under the stage: a thin frosted strip that says how the last
   run went, and a well that opens above it. It folds by height, so the
   terminal inside stays mounted and keeps its scroll. The whole strip
   toggles; so does ⌘J or Ctrl J. */

type Ctx = { open: boolean; setOpen: (open: boolean) => void; id: string }
const ConsoleDrawerContext = React.createContext<Ctx>({ open: false, setOpen: () => {}, id: "" })

function ConsoleDrawer({
  className,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  hotkey = "j",
  ...props
}: React.ComponentProps<"div"> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** the key that, with ⌘ or Ctrl, opens and closes it; null for none */
  hotkey?: string | null
}) {
  const [inner, setInner] = React.useState(defaultOpen)
  const open = openProp ?? inner
  const id = React.useId()
  const setOpen = React.useCallback(
    (next: boolean) => {
      setInner(next)
      onOpenChange?.(next)
    },
    [onOpenChange]
  )
  React.useEffect(() => {
    if (!hotkey) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === hotkey) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [hotkey, open, setOpen])
  return (
    <ConsoleDrawerContext.Provider value={{ open, setOpen, id }}>
      <div
        data-slot="console-drawer"
        data-state={open ? "open" : "closed"}
        className={cn("group/console-drawer flex w-full flex-col-reverse overflow-hidden", className)}
        {...props}
      />
    </ConsoleDrawerContext.Provider>
  )
}

/* The strip. A click anywhere on it toggles; the chevron is the real button */
function ConsoleDrawerBar({ className, onClick, children, ...props }: React.ComponentProps<"div">) {
  const { open, setOpen, id } = React.useContext(ConsoleDrawerContext)
  return (
    <div
      data-slot="console-drawer-bar"
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented && !(e.target as HTMLElement).closest("button,a,input")) setOpen(!open)
      }}
      className={cn("frosted flex h-bar cursor-pointer items-center gap-2 border-t border-border px-2.5 text-xs text-muted-foreground select-none", className)}
      {...props}
    >
      {children}
      <button
        type="button"
        data-slot="console-drawer-trigger"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "Close the console" : "Open the console"}
        onClick={() => setOpen(!open)}
        className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronUp className="size-3.5 transition-transform duration-200 group-data-[state=open]/console-drawer:rotate-180" />
      </button>
    </div>
  )
}

/* How the last run went, in words beside the dot */
function ConsoleDrawerStatus({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="console-drawer-status" className={cn("flex min-w-0 items-center gap-1.5 truncate", className)} {...props} />
}

/* The right-hand end: the shortcut, Clear. Clear hides while it is closed */
function ConsoleDrawerActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="console-drawer-actions" className={cn("ml-auto flex items-center gap-1", className)} {...props} />
}

function ConsoleDrawerContent({ className, ...props }: React.ComponentProps<"div">) {
  const { open, id } = React.useContext(ConsoleDrawerContext)
  return (
    <div
      id={id}
      role="region"
      aria-label="Console"
      data-slot="console-drawer-content"
      data-state={open ? "open" : "closed"}
      inert={!open}
      className={cn(
        "h-64 overflow-auto bg-surface-well transition-[height] duration-(--duration-base) ease-standard data-[state=closed]:h-0 motion-reduce:transition-none max-md:data-[state=open]:h-[45dvh]",
        className
      )}
      {...props}
    />
  )
}

export { ConsoleDrawer, ConsoleDrawerActions, ConsoleDrawerBar, ConsoleDrawerContent, ConsoleDrawerStatus }
