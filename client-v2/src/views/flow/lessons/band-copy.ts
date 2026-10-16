import { RUNG_COUNT } from "./hints";
import { cursorStep, foldRecord, positionNumber } from "./ledger";
import type { LessonView } from "./ledger";
import type { LessonState } from "./store";
import type { LessonMark } from "./events";
import type { LessonPath, VerifyCondition } from "./types";
import { graderClass, verifyingStage } from "./verify";

/**
 * The band's primary action *is* the criterion: one control, labelled
 * by what proves the step. Derived from the condition so the action a
 * step offers cannot drift from what actually grades it.
 */
export const primaryLabel = (c: VerifyCondition): string => {
  switch (graderClass(c)) {
    case "synchronous":
      return verifyingStage(c) === "deploy"
        ? "Deploy to prove this"
        : "Build to prove this";
    // No on-demand condition ships yet; the label exists so adding one
    // later is a data change, not a band change
    case "on-demand":
      return "Check for a transaction";
    case "attestation":
      return "Mark as read";
  }
};

/**
 * The read button's label. Until the page has been opened it is the
 * signpost D34 asked for -- the one thing that says "read first".
 */
export const readLabel = (position: number, opened: boolean): string =>
  opened ? "Read the page" : `Read step ${position} first`;

/** "2 of 4" inside the path, "done" past its end -- never "5 of 4" */
export const positionLabel = (path: LessonPath, view: LessonView): string =>
  view.cursor === "end"
    ? "done"
    : `${positionNumber(path, view)} of ${path.steps.length}`;

/** What a non-open step's sub-line says. Copy and record must agree:
 * `attested` never reads as verified, `passed` never reads as done. */
const markLine = (mark: LessonMark, verifiedBy: string): string => {
  switch (mark) {
    case "proved":
      return `Proved -- ${verifiedBy}.`;
    case "attested":
      return "You marked this read -- not machine-checked.";
    case "passed":
      return "Skipped -- not verified.";
    case "open":
      return "";
  }
};

/**
 * @returns what the band shows, or `null` when the cursor is past the
 * end -- outside a lesson, or once the path is finished
 */
export const describeStep = (state: LessonState) => {
  if (!state.path) return null;

  const view = foldRecord(state.path, state.record);
  const step = cursorStep(state.path, view);
  if (!step) return null;

  const mark = view.marks.get(step.id) ?? "open";
  const open = mark === "open";

  return {
    /** The step under the cursor, so the band never re-derives it */
    step,
    number: `Step ${positionNumber(state.path, view)} of ${
      state.path.steps.length
    }`,
    position: positionNumber(state.path, view),
    /** Whether the learner has ever opened this step's page */
    opened: view.opened.has(step.id),
    objective: step.objective,
    verifiedBy: open
      ? step.verify.kind === "read"
        ? `Not machine-checked -- continue when ${step.verifiedBy}.`
        : `Verified when ${step.verifiedBy}.`
      : markLine(mark, step.verifiedBy),
    mark,
    /** An open step offers its primary only at the frontier, where its
     * mark edges live. A passed step offers it anywhere: the repair
     * edge (`passed -> proved` on a later grade) is exactly what the
     * skip valve promised -- "clears itself if you come back and prove
     * it" -- and coming back is how the learner takes that offer. */
    offersPrimary: open ? view.cursor === view.frontier : mark === "passed",
  };
};

/**
 * @returns what the band shows once the cursor is past the last step,
 * or `null` while any step is ahead. The summary uses the record's own
 * vocabulary so it can never claim more than the marks do.
 */
export const describeFinish = (state: LessonState) => {
  const { path } = state;
  if (!path) return null;
  const view = foldRecord(path, state.record);
  if (view.cursor !== "end") return null;

  const count = (mark: LessonMark) =>
    path.steps.filter((s) => view.marks.get(s.id) === mark).length;
  const proved = count("proved");
  const attested = count("attested");
  const passed = count("passed");

  const parts = [
    proved > 0 ? `${proved} proved` : null,
    attested > 0 ? `${attested} marked read` : null,
    passed > 0 ? `${passed} skipped -- go back to prove it` : null,
  ].filter((p): p is string => p !== null);

  return {
    number: `${path.steps.length} of ${path.steps.length} steps`,
    objective: `You have finished ${path.tutorial}.`,
    verifiedBy: `${parts.join(", ")}.`,
  };
};

/**
 * The assistant action's label.
 *
 * It reads "I'm stuck" rather than "Do it" on purpose: the learner opens
 * the door, which is the unaided first attempt the learning research
 * asks for, bought with one word of copy. The button is never disabled
 * -- a dead control in a demo is worse than a label that explains
 * itself.
 */
export const assistantLabel = (rung: number, attempted: boolean) => {
  if (rung === 0) return "I'm stuck";
  if (rung >= RUNG_COUNT) return "No hints left";
  if (!attempted) return "Try it first";
  return `Another hint (${rung + 1} of ${RUNG_COUNT})`;
};
