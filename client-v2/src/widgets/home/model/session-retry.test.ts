// Renders a hook and mocks the session, so it keeps a file of its own
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/features/auth", () => ({ PgSession: session }));

import { useSessionRetry } from "./session-retry";

const wake = async (event: "focus" | "online") => {
  await act(async () => {
    window.dispatchEvent(new Event(event));
  });
};

/** The first automatic re-read, two seconds after the failure */
const firstRetry = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });

describe("widgets/home/model/session-retry", () => {
  let online: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    session.refresh.mockReset().mockResolvedValue(undefined);
    online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    online.mockRestore();
    vi.useRealTimers();
  });

  it("does nothing while inactive", async () => {
    const { result } = renderHook(() => useSessionRetry(false));
    await firstRetry();
    await wake("focus");
    expect(result.current).toEqual({ kind: "none" });
    expect(session.refresh).not.toHaveBeenCalled();
  });

  it("re-reads once on its own, then on focus and online, five in all, then offers a retry", async () => {
    const { result } = renderHook(() => useSessionRetry(true));
    expect(result.current.kind).toBe("waiting");

    await firstRetry();
    expect(session.refresh).toHaveBeenCalledTimes(1);
    for (const event of ["focus", "online", "focus", "online"] as const) {
      await wake(event);
    }
    expect(session.refresh).toHaveBeenCalledTimes(5);
    expect(result.current.kind).toBe("exhausted");

    // Spent: a further wake reads nothing more
    await wake("focus");
    expect(session.refresh).toHaveBeenCalledTimes(5);
  });

  it("backs off on a timer alone, five reads in all, with no focus or online", async () => {
    const { result } = renderHook(() => useSessionRetry(true));
    for (const ms of [2_000, 4_000, 8_000, 16_000, 32_000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }
    expect(session.refresh).toHaveBeenCalledTimes(5);
    expect(result.current.kind).toBe("exhausted");
  });

  it("counts only the reads it starts", async () => {
    let settle!: () => void;
    session.refresh.mockReturnValueOnce(
      new Promise<void>((resolve) => (settle = resolve))
    );
    const { result } = renderHook(() => useSessionRetry(true));
    await firstRetry();
    // A focus and an online together while that read is in flight
    await wake("focus");
    await wake("online");
    expect(session.refresh).toHaveBeenCalledTimes(1);
    await act(async () => settle());
    expect(result.current.kind).toBe("waiting");
  });

  it("re-arms its timer when it fired while a read was still in flight", async () => {
    let settle!: () => void;
    session.refresh.mockReturnValueOnce(
      new Promise<void>((resolve) => (settle = resolve))
    );
    renderHook(() => useSessionRetry(true));
    await firstRetry();
    // The next timer (4 s) fires while the first read hangs
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(session.refresh).toHaveBeenCalledTimes(1);
    await act(async () => settle());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(session.refresh).toHaveBeenCalledTimes(2);
  });

  it("resumes on its timer once back online", async () => {
    online.mockReturnValue(false);
    renderHook(() => useSessionRetry(true));
    await firstRetry();
    expect(session.refresh).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await firstRetry();
    expect(session.refresh).toHaveBeenCalledTimes(1);
  });

  it("pauses while offline", async () => {
    online.mockReturnValue(false);
    const { result } = renderHook(() => useSessionRetry(true));
    await firstRetry();
    await wake("focus");
    expect(session.refresh).not.toHaveBeenCalled();
    expect(result.current.kind).toBe("waiting");
  });

  it("keeps offering the retry when a pressed one fails again", async () => {
    const { result } = renderHook(() => useSessionRetry(true));
    await firstRetry();
    for (let i = 0; i < 4; i++) await wake("focus");
    const exhausted = result.current;
    if (exhausted.kind !== "exhausted") throw new Error("not exhausted");

    await act(() => exhausted.retry());

    expect(session.refresh).toHaveBeenCalledTimes(6);
    expect(result.current.kind).toBe("exhausted");
  });

  it("starts a fresh round once the check has answered", async () => {
    const { result, rerender } = renderHook(
      ({ active }) => useSessionRetry(active),
      { initialProps: { active: true } }
    );
    await firstRetry();
    for (let i = 0; i < 4; i++) await wake("focus");
    expect(result.current.kind).toBe("exhausted");

    rerender({ active: false });
    rerender({ active: true });

    expect(result.current.kind).toBe("waiting");
  });
});
