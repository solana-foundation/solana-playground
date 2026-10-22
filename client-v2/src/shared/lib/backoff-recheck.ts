/** The page as the re-check sees it: whether the tab is hidden, and its events */
type Page = {
  doc: EventTarget & { readonly hidden: boolean };
  win: EventTarget;
};

export interface BackoffRecheck {
  /**
   * The state is still bad: check again after the current delay, which then
   * doubles up to the most
   */
  arm(): void;
  /** The state is good: stop checking, and start from the least next time */
  reset(): void;
  dispose(): void;
}

/**
 * Runs `recheck` while a state stays bad: after `minMs`, then twice as long
 * each time up to `maxMs`, and at once when the tab comes back into view or
 * gains focus. Nothing runs while the tab is hidden, so an idle tab does not
 * keep asking a public endpoint. `recheck` is expected to end in `arm` or
 * `reset`.
 */
export const createBackoffRecheck = ({
  recheck,
  minMs,
  maxMs,
  page = { doc: document, win: window },
}: {
  recheck: () => void;
  minMs: number;
  maxMs: number;
  page?: Page;
}): BackoffRecheck => {
  let delay = minMs;
  let armed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  // A tick that lands on a hidden tab is dropped; showing the tab runs it
  const tick = () => {
    timer = undefined;
    if (!page.doc.hidden) recheck();
  };

  const onShown = () => {
    if (!armed || page.doc.hidden) return;
    stopTimer();
    recheck();
  };
  page.doc.addEventListener("visibilitychange", onShown);
  page.win.addEventListener("focus", onShown);

  const reset = () => {
    armed = false;
    stopTimer();
    delay = minMs;
  };

  return {
    arm() {
      armed = true;
      stopTimer();
      timer = setTimeout(tick, delay);
      delay = Math.min(delay * 2, maxMs);
    },
    reset,
    dispose() {
      reset();
      page.doc.removeEventListener("visibilitychange", onShown);
      page.win.removeEventListener("focus", onShown);
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach, afterEach } = import.meta
    .vitest;

  describe("shared/lib/backoff-recheck", () => {
    let hidden: boolean;
    let doc: EventTarget & { readonly hidden: boolean };
    let win: EventTarget;
    let recheck: import("vitest").Mock<() => void>;
    let subject: BackoffRecheck;

    beforeEach(() => {
      vi.useFakeTimers();
      hidden = false;
      doc = Object.defineProperty(new EventTarget(), "hidden", {
        get: () => hidden,
      }) as EventTarget & { readonly hidden: boolean };
      win = new EventTarget();
      recheck = vi.fn<() => void>();
      subject = createBackoffRecheck({
        recheck,
        minMs: 5000,
        maxMs: 20000,
        page: { doc, win },
      });
    });

    afterEach(() => {
      subject.dispose();
      vi.useRealTimers();
    });

    it("checks again after 5 s, then 10 s, then at most 20 s", () => {
      subject.arm();
      vi.advanceTimersByTime(4999);
      expect(recheck).toHaveBeenCalledTimes(0);
      vi.advanceTimersByTime(1);
      expect(recheck).toHaveBeenCalledTimes(1);

      subject.arm();
      vi.advanceTimersByTime(9999);
      expect(recheck).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(recheck).toHaveBeenCalledTimes(2);

      subject.arm();
      vi.advanceTimersByTime(20000);
      subject.arm();
      vi.advanceTimersByTime(20000);
      expect(recheck).toHaveBeenCalledTimes(4);
    });

    it("stops after a reset, and starts again from 5 s", () => {
      subject.arm();
      vi.advanceTimersByTime(5000);
      subject.arm();
      subject.reset();
      vi.advanceTimersByTime(60000);
      expect(recheck).toHaveBeenCalledTimes(1);

      subject.arm();
      vi.advanceTimersByTime(5000);
      expect(recheck).toHaveBeenCalledTimes(2);
    });

    it("does not check while the tab is hidden, and checks when it shows", () => {
      subject.arm();
      hidden = true;
      vi.advanceTimersByTime(60000);
      expect(recheck).toHaveBeenCalledTimes(0);

      hidden = false;
      doc.dispatchEvent(new Event("visibilitychange"));
      expect(recheck).toHaveBeenCalledTimes(1);
    });

    it("checks at once when the window gains focus", () => {
      subject.arm();
      win.dispatchEvent(new Event("focus"));
      expect(recheck).toHaveBeenCalledTimes(1);
      // The pending tick went with it
      vi.advanceTimersByTime(60000);
      expect(recheck).toHaveBeenCalledTimes(1);
    });

    it("ignores focus while nothing is bad", () => {
      win.dispatchEvent(new Event("focus"));
      expect(recheck).toHaveBeenCalledTimes(0);
    });
  });
}
