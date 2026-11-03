// Spec 08 BUILD-05's clock: a build is slow 60 s after its own start. A file
// of its own, since it renders a hook.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSlowBuild } from "./use-slow-build";

describe("views/flow/stages/use-slow-build", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const render = (building: boolean, startedAt: number | null) =>
    renderHook((p) => useSlowBuild(p.building, p.startedAt), {
      initialProps: { building, startedAt },
    });

  it("turns slow 60 s into a run, not before", () => {
    const { result } = render(true, Date.now());

    act(() => vi.advanceTimersByTime(59_999));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  // A remount mid-run must not restart the clock
  it("is slow at once for a run that started over 60 s ago", () => {
    const { result } = render(true, Date.now() - 61_000);

    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toBe(true);
  });

  it("is not slow once the run ends, and counts the next run afresh", () => {
    const { result, rerender } = render(true, Date.now());
    act(() => vi.advanceTimersByTime(60_000));

    rerender({ building: false, startedAt: null });
    expect(result.current).toBe(false);

    rerender({ building: true, startedAt: Date.now() });
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toBe(false);
  });

  it("leaves no timer behind when the run ends", () => {
    const { rerender } = render(true, Date.now());
    rerender({ building: false, startedAt: null });

    expect(vi.getTimerCount()).toBe(0);
  });
});
