import { useSyncExternalStore } from "react";

/**
 * Below `compact` the assistant is a Sheet; below `left` the project panel is
 * one; below `phone` the editor is read-only. `left` is not a `Viewport`
 * class: the stock Sidebar decides it with its own hook (`use-mobile.ts`,
 * installed from the design system), and `use-viewport.test.ts` holds the two
 * to the same width.
 */
export const LAYOUT_BREAKPOINTS = {
  compact: 1024,
  left: 768,
  phone: 600,
} as const;

export type Viewport = "wide" | "compact" | "phone";

const PHONE = `(max-width: ${LAYOUT_BREAKPOINTS.phone - 1}px)`;
const COMPACT = `(max-width: ${LAYOUT_BREAKPOINTS.compact - 1}px)`;

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
