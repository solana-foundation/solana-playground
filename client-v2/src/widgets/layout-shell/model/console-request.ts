import type { Disposable } from "@/utils/types";

const listeners = new Set<() => void>();

/**
 * Asks the shell to open the console drawer, or its sheet on a phone, as a
 * user's press: a stage's "Show full log" (Spec 08). Nothing happens while no
 * shell is mounted, or under Home or a page, which show no console.
 */
export const requestConsole = () => listeners.forEach((cb) => cb());

/** Runs `cb` on every `requestConsole`; the shell is the one listener */
export const onDidRequestConsole = (cb: () => void): Disposable => {
  listeners.add(cb);
  return { dispose: () => listeners.delete(cb) };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("widgets/layout-shell/model/console-request", () => {
    it("calls each listener on a request, and none once disposed", () => {
      const cb = vi.fn();
      const sub = onDidRequestConsole(cb);
      requestConsole();
      expect(cb).toHaveBeenCalledTimes(1);
      sub.dispose();
      requestConsole();
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
}
