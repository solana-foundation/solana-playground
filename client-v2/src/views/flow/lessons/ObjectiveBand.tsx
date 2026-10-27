import type { FC } from "react";

import { BaseObjectiveBand } from "./BaseObjectiveBand";
import type {
  BaseObjectiveBandProps,
  StepBandProps,
} from "./BaseObjectiveBand";
import {
  assistantLabel,
  describeFinish,
  describeStep,
  positionLabel,
} from "./band-copy";
import {
  attempted,
  foldRecord,
  nextLegal,
  positionNumber,
  prevLegal,
  rung,
} from "./ledger";
import { PgLesson } from "./store";
import type { LessonState } from "./store";
import { graderClass } from "./verify";
import { PgAssistant } from "../../sidebar/assistant/store";

export interface ObjectiveBandProps {
  state: LessonState;
  onRead: () => void;
  onOpenGallery: () => void;
  /** Below the phone width: the band folds and `LessonBar` holds the actions */
  phone?: boolean;
}

/**
 * The band's props from the lesson state, shared by the band and, on a
 * phone, by the bar at the foot of the code; `null` outside a lesson.
 *
 * The step's one action is "Continue" where reading proves the step and it
 * still waits to be marked, as the prototype's `continueRead`; everywhere
 * else it is the assistant, whose label climbs the hint ladder. Building and
 * deploying prove a step from the stage bar, whose stepper carries the
 * target's dot.
 */
export const bandProps = ({
  state,
  onRead,
  onOpenGallery,
  phone,
}: ObjectiveBandProps): BaseObjectiveBandProps | null => {
  if (!state.path) return null;
  const view = foldRecord(state.path, state.record);

  const back = {
    enabled: prevLegal(state.path, view) !== null,
    onClick: () => PgLesson.moveBack(),
  };
  const next = {
    enabled: nextLegal(state.path, view) !== null,
    onClick: () => PgLesson.moveForward(),
  };
  const confirmed = state.path.steps.filter((s) => {
    const mark = view.marks.get(s.id);
    return mark === "proved" || mark === "attested";
  }).length;
  const progress = confirmed / state.path.steps.length;

  // No step under the cursor means the path is finished: say so, and say
  // where to go. The rail's rows are still legal positions, so the back
  // arrow still works.
  const shown = describeStep(state);
  if (!shown) {
    const finished = describeFinish(state);
    if (!finished) return null;
    return {
      kind: "finished",
      position: {
        label: finished.number,
        short: positionLabel(state.path, view),
        progress,
      },
      objective: finished.objective,
      criterion: finished.verifiedBy,
      back,
      next,
      gallery: { label: "Browse gallery", onClick: onOpenGallery },
      phone,
    };
  }

  const { step } = shown;
  const askForHelp = () => {
    const prompt = PgLesson.requestHint();
    if (prompt) PgAssistant.requestPrompt(prompt);
  };
  const continues =
    shown.offersPrimary && graderClass(step.verify) === "attestation";
  const primary: StepBandProps["primary"] = continues
    ? { kind: "continue", label: "Continue", onClick: () => PgLesson.attest() }
    : {
        kind: "stuck",
        label: assistantLabel(
          rung(view, step.id),
          attempted(state.path, view, step.id)
        ),
        onClick: askForHelp,
      };

  return {
    kind: "step",
    position: {
      label: shown.number,
      short: `${positionNumber(state.path, view)}/${state.path.steps.length}`,
      progress,
    },
    objective: shown.objective,
    criterion: shown.verifiedBy,
    back,
    next,
    read: step.readPage ? { label: "Read the page", onClick: onRead } : null,
    primary,
    phone,
  };
};

/** One ask, above the editor, always visible */
const ObjectiveBand: FC<ObjectiveBandProps> = (props) => {
  const band = bandProps(props);
  return band && <BaseObjectiveBand {...band} />;
};

export default ObjectiveBand;
