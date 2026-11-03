import { useEffect, useState } from "react";

/**
 * How long something has run since `startedAt`, ticking once a second while
 * it runs and `null` while nothing does (`startedAt` is `null`), so an idle
 * caller keeps no timer
 */
export const useElapsed = (startedAt: number | null) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [startedAt]);
  return startedAt === null ? null : Math.max(0, now - startedAt);
};
