import type { TutorialDefinition } from "@/entities/tutorial";
import type {
  ConversationProgress,
  StepBarItem,
} from "@/features/tutorial-conversation";

/**
 * How far the step bar's hairline reaches, from 0 to 1: the steps passed,
 * plus the live step's share of the beats it has posted. A step in its
 * planned failure has posted all its own beats, so it counts as whole until
 * it passes.
 */
export const barProgress = (
  definition: TutorialDefinition,
  progress: ConversationProgress
): number => {
  const count = definition.steps.length;
  const cursor = progress.cursor;
  if (cursor.kind === "finished") return 1;

  const passed = progress.passed.length;
  if (cursor.kind !== "step" || progress.passed.includes(cursor.stepId)) {
    return passed / count;
  }
  const step = definition.steps.find((s) => s.id === cursor.stepId);
  const beats = step?.beats.length ?? 0;
  const share = cursor.fail || beats === 0 ? 1 : cursor.beat / beats;
  return Math.min(1, (passed + Math.min(1, share)) / count);
};

/**
 * From the step at index `at`, the step ⌥↑ (`by` -1) or ⌥↓ (`by` 1) moves the
 * feed to: the one before or after it, if the learner has reached it.
 * Reached steps are the passed ones and the live one, so the keys stop at the
 * first divider and at the live step. Null when there is nowhere to go.
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
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("widgets/tutorial-conversation/model/step-bar", () => {
    let hello: TutorialDefinition;

    beforeAll(async () => {
      hello = (await import("../../../tutorials/hello-anchor/tutorial.json"))
        .default as unknown as TutorialDefinition;
    });

    /** A save at `cursor` with `passed` steps; the feature's barrel loads UI */
    const progressAt = (
      cursor: ConversationProgress["cursor"],
      passed: string[] = []
    ): ConversationProgress => ({
      version: 1,
      passed,
      finishedAt: null,
      startedAt: null,
      restartedAt: null,
      cursor,
      beats: {},
      runs: {},
      times: {},
    });

    const item = (id: string, state: StepBarItem["state"]): StepBarItem => ({
      id,
      short: id,
      title: id,
      state,
      took: null,
    });

    it("draws no hairline before Start", () => {
      expect(barProgress(hello, progressAt({ kind: "intro" }))).toBe(0);
    });

    it("fills a quarter per passed step of four, plus the live step's beats", () => {
      const second = hello.steps[1];
      const passed = [hello.steps[0].id];
      expect(
        barProgress(
          hello,
          progressAt(
            { kind: "step", stepId: second.id, beat: 0, fail: false },
            passed
          )
        )
      ).toBe(0.25);

      const half = Math.floor(second.beats.length / 2);
      expect(
        barProgress(
          hello,
          progressAt(
            { kind: "step", stepId: second.id, beat: half, fail: false },
            passed
          )
        )
      ).toBeCloseTo((1 + half / second.beats.length) / 4);
    });

    it("counts a step in its planned failure as whole until it passes", () => {
      const cursor = {
        kind: "step" as const,
        stepId: hello.steps[0].id,
        beat: 0,
        fail: true,
      };
      expect(barProgress(hello, progressAt(cursor))).toBe(0.25);
    });

    it("is full after the finish", () => {
      expect(barProgress(hello, progressAt({ kind: "finished" }))).toBe(1);
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
