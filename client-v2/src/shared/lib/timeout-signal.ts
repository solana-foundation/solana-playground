/**
 * A signal that aborts a request after `ms`.
 *
 * `fetch` itself never gives up: a request stuck on a dead connection hangs
 * for as long as the browser lets it. An aborted request rejects, which lands
 * in the caller's existing catch.
 *
 * @returns the signal, or `undefined` where the browser cannot make one --
 * the request then behaves as it did before
 */
export const timeoutSignal = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== "undefined" &&
  typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("shared/lib/timeout-signal", () => {
    const original = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
    const setTimeoutFn = (value: unknown) =>
      Object.defineProperty(AbortSignal, "timeout", {
        value,
        configurable: true,
        writable: true,
      });

    afterEach(() => {
      if (original) Object.defineProperty(AbortSignal, "timeout", original);
      else delete (AbortSignal as { timeout?: unknown }).timeout;
    });

    it("is undefined where the browser cannot make one", () => {
      setTimeoutFn(undefined);
      expect(timeoutSignal(15_000)).toBeUndefined();
    });

    it("asks the browser for a signal that times out", () => {
      const signal = new AbortController().signal;
      const timeout = vi.fn(() => signal);
      setTimeoutFn(timeout);

      expect(timeoutSignal(15_000)).toBe(signal);
      expect(timeout).toHaveBeenCalledWith(15_000);
    });
  });
}
