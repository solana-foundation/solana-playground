import type { Disposable } from "./types";

/**
 * The connection's derivables a user's "Try again" asks again
 * (`PgConnection.recheck`). Kept out of `connection.ts`, whose imports need a
 * booted app, so the trigger can be tested alone.
 */
const listeners = new Set<() => void>();

/** Runs `cb` on every `askAgain`: a derivable's extra `onChange` */
export const onAskAgain = (cb: () => void): Disposable => {
  listeners.add(cb);
  return { dispose: () => listeners.delete(cb) };
};

/** Asks every listening derivable to derive again now */
export const askAgain = () => listeners.forEach((cb) => cb());

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("utils/ask-again", () => {
    it("calls each listener once per ask, and none once disposed", () => {
      const cb = vi.fn();
      const sub = onAskAgain(cb);
      askAgain();
      expect(cb).toHaveBeenCalledTimes(1);
      sub.dispose();
      askAgain();
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
}
