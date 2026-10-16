import * as React from "react"
import { cn } from "cn"

/* An achievement as a profile shows it (profiles, v0.2, proposed): a disc
   in a ring of the brand's gradient once earned, grey until then. */

function Achievement({ className, earned = true, ...props }: React.ComponentProps<"div"> & { earned?: boolean }) {
  return (
    <div
      data-slot="achievement"
      data-state={earned ? "earned" : "locked"}
      className={cn("group/achievement flex w-24 flex-col items-center gap-2 text-center", className)}
      {...props}
    />
  )
}

function AchievementMedia({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="achievement-media"
      className={cn(
        "grid size-16 place-items-center rounded-full bg-border-strong p-[2px] group-data-[state=earned]/achievement:bg-brand-fill",
        className
      )}
      {...props}
    >
      <div className="grid size-full place-items-center rounded-full bg-surface-panel text-subtle group-data-[state=earned]/achievement:text-foreground [&_svg:not([class*='size-'])]:size-6">
        {children}
      </div>
    </div>
  )
}

function AchievementLabel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="achievement-label"
      className={cn("text-caption font-label text-subtle group-data-[state=earned]/achievement:text-foreground", className)}
      {...props}
    />
  )
}

export { Achievement, AchievementLabel, AchievementMedia }
