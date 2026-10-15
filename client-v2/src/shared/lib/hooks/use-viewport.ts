import { useSyncExternalStore } from "react";

/**
 * Below `compact` the assistant is a Sheet; below `left` the navigation is
 * one, holding the files column too; below `phone` the editor is read-only.
 * `left` is not a `Viewport` class: the stock Sidebar decides it with its own
 * hook (`use-mobile.ts`, installed from the design system), and
 * `use-viewport.test.ts` holds the two to the same width.
 */
export const LAYOUT_BREAKPOINTS = {
  compact: 1024,
  left: 768,
  phone: 600,
} as const;

/**
 * The collapsed left panel's width, the rail. The layout shell sizes the
 * rail with it and the toast host keeps clear of it, so both read one value.
 */
export const RAIL_WIDTH = "3.25rem";

export type Viewport = "wide" | "compact" | "phone";

const PHONE = `(max-width: ${LAYOUT_BREAKPOINTS.phone - 1}px)`;
const COMPACT = `(max-width: ${LAYOUT_BREAKPOINTS.compact - 1}px)`;
const LEFT = `(max-width: ${LAYOUT_BREAKPOINTS.left - 1}px)`;

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

const subscribeLeft = (onChange: () => void) => {
  const list = window.matchMedia(LEFT);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
};

/**
 * Whether the window is below `LAYOUT_BREAKPOINTS.left`, where the navigation
 * is a Sheet. Right on the first render, unlike the stock Sidebar's
 * `useIsMobile`, which answers `false` until an effect runs: a layout that
 * moves the files column by this does not mount it in the work group and then
 * again in the Sheet on every phone load. Same value as that hook, held by
 * `use-viewport.test.ts`.
 */
export const useIsLeftSheet = (): boolean =>
  useSyncExternalStore(
    subscribeLeft,
    // The value the stock hook reads, not `matchMedia(...).matches`: under
    // browser zoom the two can round a fractional width to different sides,
    // and the files column would then be in neither the group nor the Sheet
    () => window.innerWidth < LAYOUT_BREAKPOINTS.left
  );
