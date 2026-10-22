import { useSyncExternalStore } from "react";

/**
 * Below `compact` the assistant is a Sheet; below `phone` the app is three
 * pages (`BasePhonePager`). `phone` is the stock Sidebar's own line
 * (`use-mobile.ts` and its `md:` classes, installed from the design system
 * and not edited), so there is no width where the frame shows and the
 * Sidebar is a Sheet; `use-viewport.test.ts` holds the two together. One
 * value until the designers settle the breakpoints (HOO-2208).
 */
export const LAYOUT_BREAKPOINTS = {
  compact: 1024,
  phone: 768,
} as const;

/**
 * The collapsed left panel's width, the rail. The layout shell sizes the
 * rail with it and the toast host keeps clear of it, so both read one value.
 */
export const RAIL_WIDTH = "3.25rem";

export type Viewport = "wide" | "compact" | "phone";

// Range syntax, not `max-width: <n - 1>px`: a zoomed window's width is
// fractional, and 767.5 px must fall below the line, as it does for the stock
// Sidebar's `md:` (`width >= 48rem`), or the frame would show with no Sidebar
const PHONE = `(width < ${LAYOUT_BREAKPOINTS.phone}px)`;
const COMPACT = `(width < ${LAYOUT_BREAKPOINTS.compact}px)`;

/** The window's width class right now */
export const viewportOf = (): Viewport => {
  if (window.matchMedia(PHONE).matches) return "phone";
  if (window.matchMedia(COMPACT).matches) return "compact";
  return "wide";
};

const subscribe = (onChange: () => void) => {
  const lists = [PHONE, COMPACT].map((query) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener("change", onChange));
  return () =>
    lists.forEach((list) => list.removeEventListener("change", onChange));
};

/** The window's width class, re-rendering when it crosses a breakpoint */
export const useViewport = (): Viewport =>
  useSyncExternalStore(subscribe, viewportOf);
