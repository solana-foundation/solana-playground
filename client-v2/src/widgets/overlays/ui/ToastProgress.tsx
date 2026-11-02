import { useSyncExternalStore } from "react";

const subscribeToVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const pageHidden = () => document.hidden;

/**
 * The accent bar along a timed toast's foot, full when it opens and empty
 * when it closes. A CSS animation over the toast's duration, not a timer of
 * its own. It pauses on the two lasting states where Sonner pauses its
 * timer: the toasts expanded under the pointer (`data-expanded`), and a
 * hidden page, where the animation would otherwise run on while the timer
 * waits. It does not follow a press held on a toast, which pauses Sonner's
 * timer too but ends in a swipe or a release within moments.
 * Under reduced motion the bar is not drawn, since a still bar would claim a
 * time it does not show.
 */
export const ToastProgress = ({ duration }: { duration: number }) => {
  const hidden = useSyncExternalStore(subscribeToVisibility, pageHidden);
  return (
    <span
      aria-hidden="true"
      // Clipped to the toast's corners, which the bar runs into
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-[var(--border-radius)] motion-reduce:hidden"
    >
      <span
        data-slot="toast-progress"
        className="block h-full origin-left animate-[pg-toast-progress_linear_forwards] bg-primary in-data-[expanded=true]:[animation-play-state:paused]"
        style={{
          animationDuration: `${duration}ms`,
          animationPlayState: hidden ? "paused" : undefined,
        }}
      />
    </span>
  );
};
