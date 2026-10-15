import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useIsMobile } from "./use-mobile";
import {
  LAYOUT_BREAKPOINTS,
  useIsLeftSheet,
  useViewport,
  viewportOf,
} from "./use-viewport";

/** A `matchMedia` that answers `max-width` queries against `width` and fires `change` when it moves */
const fakeScreen = (initial: number) => {
  let width = initial;
  const listeners = new Set<() => void>();
  const matchMedia = (query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1]);
    return {
      get matches() {
        return width <= max;
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

it("should draw the lines at 1024, 768 and 720", () => {
  expect(LAYOUT_BREAKPOINTS).toEqual({ compact: 1024, left: 768, phone: 720 });
});

it("should keep the lines in order, which viewportOf's checks rely on", () => {
  // `viewportOf` tests phone before compact, and `left` sits between them
  expect(LAYOUT_BREAKPOINTS.phone).toBeLessThan(LAYOUT_BREAKPOINTS.left);
  expect(LAYOUT_BREAKPOINTS.left).toBeLessThan(LAYOUT_BREAKPOINTS.compact);
});

it.each([
  [1440, "wide"],
  [1024, "wide"],
  [1023, "compact"],
  [768, "compact"],
  [720, "compact"],
  [719, "phone"],
  [375, "phone"],
])("should call %i px %s", (width, expected) => {
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
  [LAYOUT_BREAKPOINTS.left - 1, true],
  [LAYOUT_BREAKPOINTS.left, false],
])(
  "should agree with the stock Sidebar's own hook on the left panel's line (%i px)",
  (width, sheet) => {
    const innerWidth = window.innerWidth;
    window.innerWidth = width;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(sheet);
    window.innerWidth = innerWidth;
  }
);

it("should say on the first render that the window is below the left panel's line, and follow it", () => {
  screen.resize(500);
  const rendered: boolean[] = [];
  const { result } = renderHook(() => {
    const sheet = useIsLeftSheet();
    rendered.push(sheet);
    return sheet;
  });
  // The stock hook's first render says false and its effect corrects it; this
  // one is right in the render that mounts the column
  expect(rendered[0]).toBe(true);

  act(() => screen.resize(LAYOUT_BREAKPOINTS.left));
  expect(result.current).toBe(false);

  act(() => screen.resize(LAYOUT_BREAKPOINTS.left - 1));
  expect(result.current).toBe(true);
});
