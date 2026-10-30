import { useEffect, useState } from "react";

/** Spec 08's slow threshold for Build (draft, "to agree with dev") */
const SLOW_BUILD_MS = 60_000;

/**
 * Whether the build that started at `startedAt` has run past
 * `SLOW_BUILD_MS`. Counted from the run's own start, so a remount mid-run
 * does not restart the clock.
 */
export const useSlowBuild = (building: boolean, startedAt: number | null) => {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!building) return;
    const left = SLOW_BUILD_MS - (Date.now() - (startedAt ?? Date.now()));
    const timer = setTimeout(() => setSlow(true), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [building, startedAt]);
  return slow;
};
