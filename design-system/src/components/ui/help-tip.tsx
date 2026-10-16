import * as React from "react"
import { cn } from "cn"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/* A small question mark beside a setting, and the answer on hover or tap.
   The mark is small; the place you can press is not. */
function HelpTip({
  className,
  label = "More about this",
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & { label?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-slot="help-tip"
          aria-label={label}
          className={cn(
            "relative inline-grid size-4 place-items-center rounded-full border border-border-strong text-[10px] leading-none font-act text-muted-foreground outline-none after:absolute after:-inset-3 hover:border-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
          {...props}
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">{children}</TooltipContent>
    </Tooltip>
  )
}

export { HelpTip }
