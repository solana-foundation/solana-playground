import * as React from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/* A Button that waits for its own work. Give it an onClick that returns a
   promise and it disables itself and shows a spinner until the promise
   settles, so a slow build cannot be started twice. loading takes over when
   the wait is known elsewhere. It stays a Button: same variants, same slot. */
function AsyncButton({
  onClick,
  loading: loadingProp,
  loadingText,
  disabled,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick"> & {
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => unknown
  loading?: boolean
  /** what the button says while it waits, e.g. "Building" */
  loadingText?: React.ReactNode
}) {
  const [pending, setPending] = React.useState(false)
  const loading = loadingProp ?? pending
  return (
    <Button
      data-async=""
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      onClick={async (event) => {
        const result = onClick?.(event)
        if (result instanceof Promise) {
          setPending(true)
          try {
            await result
          } finally {
            setPending(false)
          }
        }
      }}
      {...props}
    >
      {loading && <Spinner data-icon="inline-start" />}
      {loading && loadingText ? loadingText : children}
    </Button>
  )
}

export { AsyncButton }
