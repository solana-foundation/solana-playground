import type { RestingState, RunState } from "./run";

/**
 * A state drawn over the one before it, which it keeps as `previous`: a run
 * going, the funding card, the question before a link's first Run. Kept apart
 * from the store, so the drawn components read it without loading `@/utils`.
 */
export type OverlayState = Extract<RunState, { previous: RestingState }>;

const isOverlay = (current: RunState): current is OverlayState =>
  "previous" in current;

/**
 * @returns the state under any overlay: what Not now and Cancel go back to,
 * and what the stage row and the callout keep showing
 */
export const restingOf = (current: RunState): RestingState =>
  isOverlay(current) ? current.previous : current;
