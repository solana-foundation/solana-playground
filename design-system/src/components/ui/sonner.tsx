"use client"

import { useSyncExternalStore } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Room on the right for Close, so a long line never runs under it
          toast: "cn-toast !pr-11",
          // Close inside the toast, at its end, on the first line, as every
          // other Close in the product sits: Sonner's own hangs off the corner
          // the toasts come from, half outside the card, over the nav below a
          // toast at the bottom left. Sonner styles it by attribute, so only
          // !important moves it
          closeButton:
            "!top-3.5 !right-2.5 !left-auto !size-6 !transform-none !rounded-md !border-0 !bg-transparent text-muted-foreground hover:!bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:!size-3.5",
        },
      }}
      {...props}
    />
  )
}

const subscribeToVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange)
  return () => document.removeEventListener("visibilitychange", onChange)
}
const pageHidden = () => document.hidden

/**
 * The accent bar along a timed toast's foot, full when it opens and empty
 * when it closes: put it in the toast's content with the toast's duration. A
 * CSS animation over that duration, not a timer of its own. It pauses where
 * Sonner pauses its timer for good: the toasts expanded under the pointer
 * (`data-expanded`) and a hidden page. Under reduced motion it is not drawn,
 * since a still bar would claim a time it does not show. Key it per show, so
 * a toast shown again by its id starts from full
 */
const ToastProgress = ({ duration }: { duration: number }) => {
  const hidden = useSyncExternalStore(subscribeToVisibility, pageHidden)
  return (
    <span
      aria-hidden="true"
      // Clipped to the toast's corners, which the bar runs into
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-[var(--border-radius)] motion-reduce:hidden"
    >
      <span
        data-slot="toast-progress"
        className="block h-full origin-left animate-[toast-progress_linear_forwards] bg-primary in-data-[expanded=true]:[animation-play-state:paused]"
        style={{
          animationDuration: `${duration}ms`,
          animationPlayState: hidden ? "paused" : undefined,
        }}
      />
    </span>
  )
}

export { Toaster, ToastProgress }
