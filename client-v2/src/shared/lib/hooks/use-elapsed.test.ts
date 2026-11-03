// Renders a hook, so it keeps a test file of its own
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useElapsed } from "./use-elapsed";

const START = 1_000_000;

/** When a run started, or `null` while none runs */
const flow = (running: boolean) => (running ? START : null);

describe("shared/lib/hooks/use-elapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => vi.useRealTimers());

  it("counts a run once a second", () => {
    const { result } = renderHook(() => useElapsed(flow(true)));
    expect(result.current).toBe(0);
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current).toBe(12_000);
  });

  it("is null and keeps no timer while nothing runs", () => {
    const { result } = renderHook(() => useElapsed(flow(false)));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts a new run from its own start", () => {
    const { result, rerender } = renderHook(({ at }) => useElapsed(at), {
      initialProps: { at: START as number | null },
    });
    act(() => vi.advanceTimersByTime(30_000));
    rerender({ at: START + 30_000 });
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current).toBe(2_000);
  });

  it("stops when the run ends", () => {
    const { result, rerender } = renderHook(
      ({ running }) => useElapsed(flow(running)),
      { initialProps: { running: true } }
    );
    act(() => vi.advanceTimersByTime(3_000));
    rerender({ running: false });
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
