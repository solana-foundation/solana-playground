import { cursorStep, foldRecord } from "./ledger";
import type { LessonState } from "./store";
import type { LessonStep } from "./types";

/**
 * The one rule for opening the page by itself: only on entering the
 * lesson, and only when the learner has never opened that page (D34).
 *
 * "Entering" is read off the record rather than off a mount: the store
 * appends `enter` on every load, and every later event moves the tail
 * off it, so a state whose last event is `enter` is exactly the state
 * that landed. Recording `opened` is itself such a later event, which
 * is what keeps the caller's effect from opening twice.
 *
 * @returns the step whose page should open on this state, or `null`
 */
export const entryReading = (state: LessonState): LessonStep | null => {
  if (!state.path) return null;
  const tail = state.record.events[state.record.events.length - 1];
  if (!tail || tail.type !== "enter") return null;

  const view = foldRecord(state.path, state.record);
  const step = cursorStep(state.path, view);
  if (!step || !step.readPage) return null;
  if (view.opened.has(step.id)) return null;
  return step;
};
