import { useEffect, useState } from "react";

/**
 * How long something has run since `startedAt`, ticking once a second while
 * it runs and `undefined` while nothing does (`startedAt` is `undefined`), so
 * an idle caller keeps no timer
 */
export const useElapsed = (startedAt: number | undefined) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === undefined) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [startedAt]);
  return startedAt === undefined ? undefined : Math.max(0, now - startedAt);
};
