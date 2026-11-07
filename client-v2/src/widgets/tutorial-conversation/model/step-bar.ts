/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { StepBarItem } from "@/features/tutorial-conversation";

/**
 * From the step at index `at`, the step ⌥↑ (`by` -1) or ⌥↓ (`by` 1) moves the
 * feed to: the one before or after it, if the learner has reached it.
 * Reached steps are the passed ones and the live one, so the keys stop at the
 * first step's heading and at the live step. Null when there is nowhere to go.
 */
export const stepBeside = (
  steps: readonly StepBarItem[],
  at: number,
  by: -1 | 1
): number | null => {
  const to = at + by;
  if (to < 0 || to >= steps.length) return null;
  return steps[to].state === "not_reached" ? null : to;
};

/** The index of the live step in the bar, or null before Start */
export const liveStepIndex = (steps: readonly StepBarItem[]): number | null => {
  const current = steps.findIndex((s) => s.state === "current");
  if (current !== -1) return current;
  // After the last win nothing is current: the last passed step is where the
  // learner is
  const done = steps.map((s) => s.state).lastIndexOf("done");
  return done === -1 ? null : done;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-conversation/model/step-bar", () => {
    const item = (id: string, state: StepBarItem["state"]): StepBarItem => ({
      id,
      short: id,
      title: id,
      state,
      took: null,
    });

    it("moves the keys between reached steps only, up to the live one", () => {
      const steps = [
        item("a", "done"),
        item("b", "done"),
        item("c", "current"),
        item("d", "not_reached"),
      ];
      expect(stepBeside(steps, 2, -1)).toBe(1);
      expect(stepBeside(steps, 0, -1)).toBeNull();
      expect(stepBeside(steps, 1, 1)).toBe(2);
      expect(stepBeside(steps, 2, 1)).toBeNull();
    });

    it("finds the live step, the last passed one after the finish, none before Start", () => {
      expect(liveStepIndex([item("a", "done"), item("b", "current")])).toBe(1);
      expect(liveStepIndex([item("a", "done"), item("b", "done")])).toBe(1);
      expect(
        liveStepIndex([item("a", "not_reached"), item("b", "not_reached")])
      ).toBeNull();
    });
  });
}
