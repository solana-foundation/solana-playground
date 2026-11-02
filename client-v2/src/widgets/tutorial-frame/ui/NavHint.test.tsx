import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FRAME_KEYS } from "../model/storage";
import NavHint, { NAV_HINT_TEXT } from "./NavHint";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const shown = () => screen.queryByRole("status")?.textContent ?? null;

describe("NavHint", () => {
  it("shows on the first fold and goes after 6 s", () => {
    render(<NavHint folded />);
    expect(shown()).toBe(NAV_HINT_TEXT);
    act(() => vi.advanceTimersByTime(5_900));
    expect(shown()).toBe(NAV_HINT_TEXT);
    // Six seconds start the fade, which takes its own 120 ms
    act(() => vi.advanceTimersByTime(100));
    act(() => vi.advanceTimersByTime(200));
    expect(shown()).toBeNull();
  });

  it("goes on a key or a pointer down", () => {
    const { unmount } = render(<NavHint folded />);
    fireEvent.keyDown(window, { key: "a" });
    act(() => vi.advanceTimersByTime(200));
    expect(shown()).toBeNull();
    unmount();

    localStorage.clear();
    render(<NavHint folded />);
    fireEvent.pointerDown(window);
    act(() => vi.advanceTimersByTime(200));
    expect(shown()).toBeNull();
  });

  it("shows only once", () => {
    const { unmount } = render(<NavHint folded />);
    expect(localStorage.getItem(FRAME_KEYS.hintSeen)).toBe("1");
    unmount();
    render(<NavHint folded />);
    expect(shown()).toBeNull();
  });

  it("waits while the navigation is not folded", () => {
    const { rerender } = render(<NavHint folded={false} />);
    expect(shown()).toBeNull();
    expect(localStorage.getItem(FRAME_KEYS.hintSeen)).toBeNull();
    rerender(<NavHint folded />);
    expect(shown()).toBe(NAV_HINT_TEXT);
  });

  it("hides while the navigation is open, and does not come back", () => {
    const { rerender } = render(<NavHint folded />);
    rerender(<NavHint folded={false} />);
    expect(shown()).toBeNull();
    rerender(<NavHint folded />);
    expect(shown()).toBeNull();
  });
});
