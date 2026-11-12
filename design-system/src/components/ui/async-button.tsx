import * as React from "react"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/* One of the two labels: both sit in the same cell, aligned as the button
   aligns its content (centred, or flush left for a justify-start caller) */
const LABEL_LAYER =
  "col-start-1 row-start-1 inline-flex items-center [justify-content:inherit] gap-[inherit]"

/* A Button that waits for its own work. Give it an onClick that returns a
   promise or any thenable and it disables itself and shows a spinner until
   that settles, so a slow build cannot be started twice. loading adds a wait
   known elsewhere: the button is busy while either holds, and loading={false}
   never switches off its own wait. A rejection or a throw goes to onError;
   with no onError it is rethrown, so it surfaces as an unhandled rejection.
   It stays a Button: same variants, same slot. The busy state is its own, so
   a caller cannot override disabled, aria-busy or data-loading, and asChild
   is not offered: the spinner needs a real button to sit in. With a
   loadingText, both labels share one grid cell and the hidden one keeps
   its room, so the button is as wide busy as idle and nothing beside it
   moves while it waits (HOO-2795). */
function AsyncButton({
  onClick,
  onError,
  loading: loadingProp,
  loadingText,
  disabled,
  className,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof Button>,
  "onClick" | "onError" | "asChild"
> & {
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => unknown
  /** where a failed click goes; without it the failure is rethrown */
  onError?: (error: unknown) => void
  /** a wait known elsewhere; it adds to the button's own, never replaces it */
  loading?: boolean
  /** what the button says while it waits, e.g. "Building" */
  loadingText?: React.ReactNode
}) {
  const [pending, setPending] = React.useState(false)
  const loading = Boolean(loadingProp) || pending
  return (
    <Button
      {...props}
      data-async=""
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      /* Busy is not unavailable: it keeps its colour, the spinner says wait */
      className={cn("data-loading:disabled:opacity-100", className)}
      onClick={async (event) => {
        try {
          const result = onClick?.(event)
          if (typeof (result as PromiseLike<unknown> | undefined)?.then === "function") {
            setPending(true)
            await (result as PromiseLike<unknown>)
          }
        } catch (error) {
          if (!onError) throw error
          onError(error)
        } finally {
          setPending(false)
        }
      }}
    >
      {loadingText ? (
        <span data-slot="async-button-label" className="inline-grid [justify-content:inherit] gap-[inherit]">
          <span
            aria-hidden={loading || undefined}
            className={cn(LABEL_LAYER, loading && "invisible")}
          >
            {children}
          </span>
          <span
            aria-hidden={!loading || undefined}
            className={cn(LABEL_LAYER, !loading && "invisible")}
          >
            {/* No data-icon: it would give the idle button, too, the
                narrower inline-start padding and set its label off centre.
                Hidden, it stops spinning: a card of Send buttons would
                otherwise animate every one of them. aria-hidden: aria-busy
                and the busy label say it waits, so the name stays the label
                ("Sending…"), not "Loading Sending…" */}
            <Spinner
              aria-hidden
              className={loading ? undefined : "animate-none"}
            />
            {loadingText}
          </span>
        </span>
      ) : (
        <>
          {loading && <Spinner data-icon="inline-start" />}
          {children}
        </>
      )}
    </Button>
  )
}

export { AsyncButton }
