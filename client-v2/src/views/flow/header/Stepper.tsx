import { useEffect, useRef, useState } from "react";
import type { FC } from "react";

import {
  Stepper as DsStepper,
  StepperItem,
  StepperList,
} from "@/shared/ui/stepper";
import type { StepperStatus } from "@/shared/ui/stepper";

import { STEPPER_FULL_WIDTH_PX } from "./stepper-width";
import { stagesOf } from "../state/stage";
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
  /**
   * Stretch the list across its row, the stages sharing the width equally
   * (the frame's stage tabs, design.md "Frame chrome (5.25)")
   */
  fill?: boolean;
  /**
   * The phone's preview bar, the prototype's `PreviewRail`: Write is the
   * code's own page there, so it has no tab, and the other three fit in full,
   * so the labels never fold
   */
  phone?: boolean;
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
 * The stages `stagesOf(state)` offers -- the write -> build -> deploy ->
 * interact loop, or Write alone for a project with no program -- drawn with the design
 * system's stepper. Each stage's status is carried by glyph shape as well as
 * color, so the sequence reads correctly without color vision.
 */
const Stepper: FC<StepperProps> = ({
  state,
  onSelect,
  target,
  fill,
  phone,
}) => {
  // The root fills its row, so what it measures is the room the row
  // gives, not the list's own width. Folding the labels shrinks the list but
  // not the root, so the fold cannot flip itself back. Until the first
  // measurement the labels show in full; the observer's first callback runs
  // before paint, and the state it sets commits after. A hidden bar reports
  // a width of 0, which says nothing about the room it gives once shown, so
  // the last real width stands.
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry && entry.contentRect.width > 0) {
        setRoom(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const compact = !phone && room !== null && room < STEPPER_FULL_WIDTH_PX;
  const offered = stagesOf(state);
  const stages = phone ? offered.filter((stage) => stage !== "write") : offered;
  return (
    <DsStepper
      ref={ref}
      className="w-full min-w-0 items-center"
      value={state.stage}
      onValueChange={(v) => onSelect(v as Stage)}
    >
      <StepperList
        compact={compact}
        className={fill || phone ? "w-full" : undefined}
      >
        {stages.map((stage) => {
          const status = statusOf(state, stage);
          return (
            <StepperItem
              key={stage}
              value={stage}
              status={DS_STATUS[status]}
              errors={stage === "build" ? state.buildErrorCount : undefined}
              target={stage === target}
              className={
                phone ? "h-12 flex-1 justify-center text-control" : undefined
              }
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
