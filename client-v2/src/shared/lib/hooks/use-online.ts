import { useSyncExternalStore } from "react";

/** Whether the browser says it has a network (`navigator.onLine`) */
const isOnline = () => navigator.onLine;

/** Calls `onChange` on the window's `online` and `offline` events */
const onOnlineChange = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

/** Whether the browser has a network, re-rendering when that changes */
export const useOnline = (): boolean =>
  useSyncExternalStore(onOnlineChange, isOnline);

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("shared/lib/hooks/use-online", () => {
    afterEach(() => vi.restoreAllMocks());

    it("reads the browser's own answer", () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      expect(isOnline()).toBe(false);
    });

    it("hears both events until unsubscribed", () => {
      const onChange = vi.fn();
      const stop = onOnlineChange(onChange);
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
      expect(onChange).toHaveBeenCalledTimes(2);

      stop();
      window.dispatchEvent(new Event("offline"));
      expect(onChange).toHaveBeenCalledTimes(2);
    });
  });
}
