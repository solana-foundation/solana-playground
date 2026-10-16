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
