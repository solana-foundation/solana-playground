import { useLayoutEffect, useRef } from "react";

/** How long the check takes to draw itself */
const DRAW_MS = 420;

const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A check in a circle that draws its stroke when it mounts on a live card,
 * the win's or the finish's; static under reduced motion. The animation
 * starts before the first paint, so the finished check never shows for a
 * frame first.
 */
export const BaseDrawnCheck = ({ draw }: { draw: boolean }) => {
  const path = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    if (!draw || reducedMotion()) return;
    path.current?.animate?.(
      [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
      { duration: DRAW_MS, easing: "ease-out" }
    );
  }, [draw]);
  return (
    <svg
      role="img"
      aria-label="Passed"
      viewBox="0 0 24 24"
      className="size-7 shrink-0 text-success"
    >
      <circle cx="12" cy="12" r="11" className="fill-success/14" />
      <path
        ref={path}
        d="M7 12.5l3.2 3.2L17 9"
        pathLength={1}
        strokeDasharray={1}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
