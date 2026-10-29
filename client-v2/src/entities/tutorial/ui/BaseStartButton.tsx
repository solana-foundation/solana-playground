import { useState } from "react";
import { CheckIcon } from "lucide-react";

import { AsyncButton } from "@/shared/ui/async-button";
import { BrandButton, BrandButtonIcon } from "@/shared/ui/brand-button";
import { Spinner } from "@/shared/ui/spinner";
import { cn } from "@/shared/lib/utils";

type BaseStartButtonProps = {
  progress: "new" | "started" | "completed";
  onStart: () => Promise<void>;
  /** Where a failed start goes */
  onError: (error: unknown) => void;
  className?: string;
};

/**
 * The tutorial page's primary action, in title case as the stand draws it.
 *
 * A completed tutorial is an `AsyncButton`. The brand button has no busy
 * state of its own, so it keeps AsyncButton's: disabled, `aria-busy` and a
 * spinner until the start settles, the failure handed to `onError`.
 */
function BaseStartButton({
  progress,
  onStart,
  onError,
  className,
}: BaseStartButtonProps) {
  const [pending, setPending] = useState(false);

  if (progress === "completed") {
    return (
      <AsyncButton
        variant="ghost"
        className={cn("text-success", className)}
        onClick={onStart}
        onError={onError}
      >
        <CheckIcon data-icon="inline-start" />
        Completed
      </AsyncButton>
    );
  }

  const start = async () => {
    setPending(true);
    try {
      await onStart();
    } catch (error) {
      onError(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <BrandButton
      className={className}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={start}
    >
      {progress === "started" ? "Continue" : "Start"}
      {pending ? <Spinner /> : <BrandButtonIcon />}
    </BrandButton>
  );
}

export { BaseStartButton };
export type { BaseStartButtonProps };
