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

/**
 * Whether a recheck found the cluster answering, from `getIsConnected` and
 * `getIsClusterDown`: it was reached and its slot is not standing still. A
 * stall check that could not read the slot again (`null`) is not a stall, so
 * a cluster that answered is not reported as one that did not.
 */
export const hasAnsweredAgain = (connected: boolean, stalled: boolean | null) =>
  connected === true && stalled !== true;

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

    it("answers again when the cluster gives a moving slot", () => {
      expect(hasAnsweredAgain(true, false)).toBe(true);
    });

    it("does not answer when it cannot be reached or its slot stands still", () => {
      // eslint-disable-next-line unicorn/no-null -- getIsClusterDown's "could not tell"
      expect(hasAnsweredAgain(false, null)).toBe(false);
      expect(hasAnsweredAgain(true, true)).toBe(false);
    });

    it("answers when it was reached but a second slot read failed", () => {
      // The stall check could not tell: `null` is not a stall, and a Try
      // again that reached the cluster must not say it could not
      // eslint-disable-next-line unicorn/no-null -- getIsClusterDown's "could not tell"
      expect(hasAnsweredAgain(true, null)).toBe(true);
    });
  });
}
