/**
 * Labels the cards draw and the assistant's context names (`context.ts`),
 * declared once, so a renamed button is renamed for both
 */

/** The foot buttons of an open question's card (`BaseQuestionCard`) */
export const QUESTION_BUTTONS = {
  hint: "Hint",
  typeIt: "Type it myself",
  skip: "Skip",
} as const;

/** A win card's tag (`BaseWinCard`), by the step's 1-based index */
export const stepDoneLabel = (index: number): string => `Step ${index} done`;

/** A win card's button to the next step, by its title (`BaseWinCard`) */
export const nextStepLabel = (title: string): string => `Next: ${title}`;
