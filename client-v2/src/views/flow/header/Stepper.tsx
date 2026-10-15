import { useSyncExternalStore } from "react";
import type { FC } from "react";

import {
  Stepper as DsStepper,
  StepperItem,
  StepperList,
} from "@/shared/ui/stepper";
import type { StepperStatus } from "@/shared/ui/stepper";

import { STAGES } from "../state/stage";
import type { FlowState, Stage, StageStatus } from "../state/stage";

const LABEL: Record<Stage, string> = {
  write: "Write",
  build: "Build",
  deploy: "Deploy",
  interact: "Interact",
};

/**
 * Writing has no completion signal of its own, so it is inferred: reaching a
 * build is what puts it behind you. Going back to the Write tab to look at
 * your code does not un-write it — deriving `done` from the selected tab alone
 * left Write showing as not done every time the learner glanced at their
 * own source.
 *
 * A build restored from the workspace's own record counts too: it happened,
 * even though `buildStartedAt` names a run this page never watched.
 */
export const statusOf = (state: FlowState, stage: Stage): StageStatus => {
  if (stage === "write") {
    if (state.buildStartedAt !== null || state.build !== "upcoming") {
      return "done";
    }
    return state.stage === "write" ? "active" : "done";
  }
  return state[stage];
};

interface StepperProps {
  state: FlowState;
  onSelect: (stage: Stage) => void;
  /** The stage the current lesson step is aiming at; `null` outside a lesson. */
  target?: Stage | null;
}

/** `upcoming` and `active` both mean "nothing to report": the thumb marks the current stage */
const DS_STATUS: Record<StageStatus, StepperStatus> = {
  upcoming: "idle",
  active: "idle",
  done: "done",
  running: "running",
  failed: "failed",
};

/**
 * Below this width the four labels collapse to their initials. The breakpoint
 * follows the window, not the stage bar's own width. The full name stays in
 * each tab's `aria-label`.
 */
const STEPPER_COMPACT_QUERY = "(max-width: 80rem)";

const subscribeCompact = (onChange: () => void) => {
  const list = window.matchMedia(STEPPER_COMPACT_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
};
const isCompact = () => window.matchMedia(STEPPER_COMPACT_QUERY).matches;

/**
 * The write -> build -> deploy -> interact loop, drawn with the design
 * system's stepper. Each stage's status is carried by glyph shape as well as
 * color, so the sequence reads correctly without color vision.
 */
const Stepper: FC<StepperProps> = ({ state, onSelect, target }) => {
  const compact = useSyncExternalStore(subscribeCompact, isCompact);
  return (
    <DsStepper value={state.stage} onValueChange={(v) => onSelect(v as Stage)}>
      <StepperList compact={compact}>
        {STAGES.map((stage) => {
          const status = statusOf(state, stage);
          return (
            <StepperItem
              key={stage}
              value={stage}
              status={DS_STATUS[status]}
              errors={stage === "build" ? state.buildErrorCount : undefined}
              target={stage === target}
              id={`flow-stage-tab-${stage}`}
              aria-controls={`flow-stage-panel-${stage}`}
              aria-label={`${LABEL[stage]}: ${status}${
                // Spoken here as well as drawn: a pre-compiler failure has no
                // count, so saying "0 errors" would mislead.
                stage === "build" &&
                status === "failed" &&
                state.buildErrorCount > 0
                  ? `, ${state.buildErrorCount} error${
                      state.buildErrorCount === 1 ? "" : "s"
                    }`
                  : ""
              }${stage === target ? ", current lesson target" : ""}`}
            >
              {LABEL[stage]}
            </StepperItem>
          );
        })}
      </StepperList>
    </DsStepper>
  );
};

export default Stepper;
