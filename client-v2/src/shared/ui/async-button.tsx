import * as React from "react";

import { Button } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";

/* A Button that waits for its own work. Give it an onClick that returns a
   promise or any thenable and it disables itself and shows a spinner until
   that settles, so a slow build cannot be started twice. loading adds a wait
   known elsewhere: the button is busy while either holds, and loading={false}
   never switches off its own wait. A rejection or a throw goes to onError;
   with no onError it is rethrown, so it surfaces as an unhandled rejection.
   It stays a Button: same variants, same slot. The busy state is its own, so
   a caller cannot override disabled, aria-busy or data-loading, and asChild
   is not offered: the spinner needs a real button to sit in. */
function AsyncButton({
  onClick,
  onError,
  loading: loadingProp,
  loadingText,
  disabled,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof Button>,
  "onClick" | "onError" | "asChild"
> & {
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => unknown;
  /** where a failed click goes; without it the failure is rethrown */
  onError?: (error: unknown) => void;
  /** a wait known elsewhere; it adds to the button's own, never replaces it */
  loading?: boolean;
  /** what the button says while it waits, e.g. "Building" */
  loadingText?: React.ReactNode;
}) {
  const [pending, setPending] = React.useState(false);
  const loading = Boolean(loadingProp) || pending;
  return (
    <Button
      {...props}
      data-async=""
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      onClick={async (event) => {
        try {
          const result = onClick?.(event);
          if (
            typeof (result as PromiseLike<unknown> | undefined)?.then ===
            "function"
          ) {
            setPending(true);
            await (result as PromiseLike<unknown>);
          }
        } catch (error) {
          if (!onError) throw error;
          onError(error);
        } finally {
          setPending(false);
        }
      }}
    >
      {loading && <Spinner data-icon="inline-start" />}
      {loading && loadingText ? loadingText : children}
    </Button>
  );
}

export { AsyncButton };
