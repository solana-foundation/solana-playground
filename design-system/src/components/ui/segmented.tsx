import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { useIndicator } from "@/hooks/use-indicator"

/* One choice out of a few, always one. Four looks, from client-v2:
   thumb    a neutral thumb that slides (the left panel's switch)
   boxed    tabs in a well, the current one lifted, with a count (the gallery)
   gradient the current option ringed in Solana's colours (a framework)
   chips    small chips, the current one purple (a network, in settings) */

const segmentedVariants = cva("group/segmented relative inline-flex w-fit items-center", {
  variants: {
    variant: {
      thumb: "h-7 rounded-lg border border-border bg-surface-panel p-0.5",
      boxed: "gap-1 rounded-xl bg-surface-base p-1",
      gradient: "gap-2",
      chips: "flex-wrap gap-1.5",
    },
  },
  defaultVariants: {
    variant: "thumb",
  },
})

const Variant = React.createContext<NonNullable<VariantProps<typeof segmentedVariants>["variant"]>>("thumb")

/* The keys roving focus moves on. Selection follows focus only after one of
   these, so a Tab, a Shift+Tab onto a stale tab stop or a programmatic focus
   never picks by itself; a click picks through the toggle as before */
const MOVE_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]

const FollowFocus = React.createContext<{ moved: React.RefObject<boolean>; pick: (value: string) => void } | null>(null)

function Segmented({
  className,
  variant = "thumb",
  value,
  defaultValue,
  onValueChange,
  rovingFocus,
  onKeyDown,
  onPointerDown,
  onBlur,
  children,
  ...props
}: Omit<React.ComponentProps<typeof ToggleGroupPrimitive.Root>, "type" | "value" | "defaultValue" | "onValueChange"> &
  VariantProps<typeof segmentedVariants> & {
    value?: string
    defaultValue?: string
    onValueChange?: (value: string) => void
  }) {
  const [inner, setInner] = React.useState(defaultValue ?? "")
  const current = value ?? inner
  const [ref, box] = useIndicator<HTMLDivElement>('[data-slot="segmented-item"][data-state="on"]', [current, children])
  const pick = (v: string) => {
    if (!v) return /* one is always chosen */
    setInner(v)
    onValueChange?.(v)
  }
  /* Set by a move key, spent by the focus it causes. Radix moves the focus on
     a timer after the key, so the flag cannot be cleared on the key itself;
     any other key, a pointer or focus leaving the group clears it instead */
  const moved = React.useRef(false)
  return (
    <Variant.Provider value={variant ?? "thumb"}>
      <FollowFocus.Provider value={{ moved, pick }}>
        <ToggleGroupPrimitive.Root
          ref={ref}
          type="single"
          data-slot="segmented"
          data-variant={variant}
          value={current}
          onValueChange={pick}
          rovingFocus={rovingFocus}
          onKeyDown={(e) => {
            moved.current = rovingFocus !== false && MOVE_KEYS.includes(e.key)
            onKeyDown?.(e)
          }}
          onPointerDown={(e) => {
            moved.current = false
            onPointerDown?.(e)
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) moved.current = false
            onBlur?.(e)
          }}
          className={cn(segmentedVariants({ variant }), className)}
          {...props}
        >
        {variant === "thumb" && (
          <span
            data-slot="segmented-thumb"
            aria-hidden="true"
            className="pointer-events-none absolute top-0.5 left-0 h-[calc(100%-4px)] rounded-md bg-surface-hover shadow-thumb transition-[transform,width] duration-(--duration-thumb) ease-standard motion-reduce:transition-none"
            style={box ? { width: box.width, transform: `translateX(${box.left}px)` } : { opacity: 0 }}
          />
        )}
        {children}
        </ToggleGroupPrimitive.Root>
      </FollowFocus.Provider>
    </Variant.Provider>
  )
}

const segmentedItemVariants = cva(
  "relative z-10 inline-flex shrink-0 items-center justify-center gap-1.5 text-[0.8125rem] font-act whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        thumb: "h-full rounded-md px-3 text-muted-foreground hover:text-foreground data-[state=on]:text-foreground",
        boxed: "h-8 rounded-[10px] px-3 text-muted-foreground hover:text-foreground data-[state=on]:bg-surface-panel data-[state=on]:text-foreground",
        gradient:
          "h-8 rounded-lg border border-border px-3 text-muted-foreground hover:border-border-strong hover:text-foreground data-[state=on]:gradient-stroke data-[state=on]:text-foreground data-[state=on]:[--stroke-fill:var(--surface-panel)]",
        chips:
          "h-7 rounded-md border border-border px-2.5 text-muted-foreground hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground",
      },
    },
    defaultVariants: {
      variant: "thumb",
    },
  }
)

function SegmentedItem({ className, value, onFocus, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  const variant = React.useContext(Variant)
  const follow = React.useContext(FollowFocus)
  return (
    <ToggleGroupPrimitive.Item
      data-slot="segmented-item"
      value={value}
      onFocus={(e) => {
        /* The root has radio semantics: the arrow keys move the choice, not
           only the focus */
        if (follow?.moved.current) {
          follow.moved.current = false
          if (e.currentTarget.getAttribute("data-state") !== "on") follow.pick(value)
        }
        onFocus?.(e)
      }}
      className={cn(segmentedItemVariants({ variant }), className)}
      {...props}
    />
  )
}

/* How many there are behind a tab: "Tutorials 12" */
function SegmentedCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="segmented-count"
      className={cn("rounded-full bg-surface-base px-1.5 text-[0.6875rem] text-muted-foreground tabular-nums", className)}
      {...props}
    />
  )
}

export { Segmented, SegmentedCount, SegmentedItem, segmentedItemVariants, segmentedVariants }
