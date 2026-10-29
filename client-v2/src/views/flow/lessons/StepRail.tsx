import type { FC } from "react";

import BaseStepRail, { railStatus } from "./BaseStepRail";
import type { RailRow } from "./BaseStepRail";
import { foldRecord, legal } from "./ledger";
import { PgLesson } from "./store";
import type { LessonState } from "./store";
import { targetStage } from "./verify";

interface StepRailProps {
  state: LessonState;
}

/**
 * The lesson's steps, marked with what actually confirmed them.
 *
 * An honest map: rows at legal positions are buttons that move there
 * (master-2.0's navigation; design.md "Lessons (5.19)" overrides the
 * design system's "not a way to jump"), and clicking one proves nothing.
 * An open row at the frontier is `next`, every other open row `locked`
 * (`railStatus`). The meta lines are the prototype's: "aiming at" the
 * stage that proves the step, "locked" for a step not reached.
 */
const StepRail: FC<React.PropsWithChildren<StepRailProps>> = ({ state }) => {
  const { path } = state;
  if (!path) return null;

  const view = foldRecord(path, state.record);

  const rows: RailRow[] = path.steps.map((step, i) => {
    const mark = view.marks.get(step.id) ?? "open";
    const isCurrent = view.cursor === i;
    const atFrontier = view.frontier === i;

    let meta = "locked";
    if (mark === "proved") meta = step.verifiedBy;
    else if (mark === "attested")
      meta = "you marked this read — not machine-checked";
    else if (mark === "passed") meta = "skipped — not verified";
    else if (atFrontier) meta = `aiming at ${targetStage(step.verify)}`;

    return {
      id: step.id,
      objective: step.objective,
      meta,
      status: railStatus(mark, { isCurrent, atFrontier }),
      canGo: !isCurrent && legal(path, view, i),
    };
  });

  return <BaseStepRail rows={rows} onGo={(id) => PgLesson.move(id)} />;
};

export default StepRail;
