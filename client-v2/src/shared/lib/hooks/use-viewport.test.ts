import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useIsMobile } from "./use-mobile";
import { LAYOUT_BREAKPOINTS, useViewport, viewportOf } from "./use-viewport";

/**
 * A `matchMedia` that answers `max-width` and `width <` queries against
 * `width`, fractional too, as a zoomed browser measures it, and fires `change`
 * when it moves
 */
const fakeScreen = (initial: number) => {
  let width = initial;
  const listeners = new Set<() => void>();
  const matchMedia = (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)?.[1];
    const below = /width\s*<\s*(\d+)px/.exec(query)?.[1];
    return {
      get matches() {
        if (below !== undefined) return width < Number(below);
        return width <= Number(max);
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  };
  window.innerWidth = initial;
  const resize = (next: number) => {
    width = next;
    window.innerWidth = next;
    listeners.forEach((fn) => fn());
  };
  return { matchMedia, resize };
};

const initialInnerWidth = window.innerWidth;
let screen: ReturnType<typeof fakeScreen>;
beforeEach(() => {
  screen = fakeScreen(1440);
  vi.stubGlobal("matchMedia", screen.matchMedia);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.innerWidth = initialInnerWidth;
});

it("should draw the lines at 1024 and 768", () => {
  expect(LAYOUT_BREAKPOINTS).toEqual({ compact: 1024, phone: 768 });
});

it.each([
  [1440, "wide"],
  [1024, "wide"],
  [1023, "compact"],
  [768, "compact"],
  // Zoomed, the width is fractional: below the stock Sidebar's `md:` (48rem)
  // it is the pager's, or the frame would show with no Sidebar in it
  [767.5, "phone"],
  [767, "phone"],
  [720, "phone"],
  [375, "phone"],
])("should call %s px %s", (width, expected) => {
  screen.resize(width);
  expect(viewportOf()).toBe(expected);
});

it("should re-render when the window crosses a line", () => {
  const { result } = renderHook(() => useViewport());
  expect(result.current).toBe("wide");

  act(() => screen.resize(800));
  expect(result.current).toBe("compact");

  act(() => screen.resize(375));
  expect(result.current).toBe("phone");
});

it.each([
  [LAYOUT_BREAKPOINTS.phone - 1, true],
  [LAYOUT_BREAKPOINTS.phone, false],
])(
  "should agree with the stock Sidebar's own hook on the phone's line, so there is no left Sheet above it (%i px)",
  (width, sheet) => {
    const innerWidth = window.innerWidth;
    window.innerWidth = width;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(sheet);
    window.innerWidth = innerWidth;
  }
);
