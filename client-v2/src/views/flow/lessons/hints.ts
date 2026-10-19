import type { LessonStep } from "./types";

/** Question -> locate -> propose */
export const RUNG_COUNT = 3;

/**
 * The hint ladder's prompt.
 *
 * Prompt policy is the lever here: the model would otherwise answer
 * immediately, so each rung asks for a different kind of help and the
 * rung is named inside the prompt itself. That makes it the learner's
 * own visible message in the transcript, which is what keeps a ladder
 * nobody counts from quietly becoming an answer machine.
 *
 * How many rungs a step has spent is a query over the lesson's event
 * log (`rung` in `ledger.ts`), so the counts survive a reload and the
 * record keeps which rung was used -- there is no ladder state outside
 * the log. The gate (unaided first attempt, then the cap) lives in the
 * store's `hint` action.
 *
 * @param step the step being worked on
 * @param rung the rung being climbed, 1-based
 */
export const hintPrompt = (step: LessonStep, rung: number): string =>
  [
    `Hint ${rung} of ${RUNG_COUNT}.`,
    `I am on this lesson step: ${step.objective}`,
    `It is finished when ${step.verifiedBy}.`,
    step.hints[rung - 1],
  ].join("\n");

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/lessons/hints", () => {
    const step: LessonStep = {
      id: "greet",
      objective: "Give hello a name argument",
      verifiedBy: "the interface shows hello(name)",
      verify: { kind: "idl", instruction: "hello", arg: "name" },
      hints: [
        "Ask me a question that points at what I am missing.",
        "Name the concept and where to look.",
        "Propose the patch.",
      ],
    };

    describe("hintPrompt", () => {
      it("names the rung inside the prompt itself", () => {
        expect(hintPrompt(step, 1)).toContain(`Hint 1 of ${RUNG_COUNT}`);
        expect(hintPrompt(step, 3)).toContain(`Hint 3 of ${RUNG_COUNT}`);
      });

      it("carries the step's own text for the rung it is on", () => {
        expect(hintPrompt(step, 1)).toContain(step.hints[0]);
        expect(hintPrompt(step, 2)).toContain(step.hints[1]);
        expect(hintPrompt(step, 3)).toContain(step.hints[2]);
      });

      it("names the objective, so the assistant answers inside the step", () => {
        expect(hintPrompt(step, 1)).toContain(step.objective);
      });

      it("names the criterion, so the assistant aims at what proves it", () => {
        expect(hintPrompt(step, 1)).toContain(step.verifiedBy);
      });
    });
  });
}
