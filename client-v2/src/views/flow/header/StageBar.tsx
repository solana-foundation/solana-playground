import type { FC } from "react";
import { useEffect, useState } from "react";

import Stepper from "./Stepper";
import {
  cursorStep,
  foldRecord,
  INITIAL_LESSON_STATE,
  PgLesson,
  targetStage,
} from "../lessons";
import type { LessonState } from "../lessons";
import { INITIAL_FLOW_STATE, PgFlow, STAGES } from "../state/stage";
import type { FlowState } from "../state/stage";
import { useKeybind } from "../../../hooks";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { cn } from "@/shared/lib/utils";

/**
 * The dev-loop stepper: in the frame, a full-width row of stage tabs under the
 * stage bar, across the files column and the stage (`LayoutShell`'s
 * `stageTabs`, design.md "Frame chrome (5.25)"); on a phone, across the
 * preview page's bar, without Write, which is the code's own page there. It owns the Ctrl+1..4 stage keys and
 * points the stepper at the stage the current lesson step is graded on. The
 * project list and the session footer live in the navigation (`AppNav`),
 * not here.
 */
const StageBar: FC = () => {
  const [state, setState] = useState<FlowState>(INITIAL_FLOW_STATE);
  useEffect(() => PgFlow.onDidChange(setState).dispose, []);

  const [lesson, setLesson] = useState<LessonState>(INITIAL_LESSON_STATE);
  useEffect(() => PgLesson.onDidChange(setLesson).dispose, []);

  const step = lesson.path
    ? cursorStep(lesson.path, foldRecord(lesson.path, lesson.record))
    : null;
  const target = step ? targetStage(step.verify) : null;

  // Cmd/Ctrl+1..4 jump to a stage. `PgKeybind` folds `metaKey` into CTRL, so
  // one binding covers both platforms.
  useKeybind(
    STAGES.map((stage, i) => ({
      keybind: `Ctrl+${i + 1}`,
      handle: () => {
        PgFlow.setStage(stage);
        // Focus follows the shortcut, so the keyboard user lands on the tab
        // they just selected rather than being left wherever they were
        document.getElementById(`flow-stage-tab-${stage}`)?.focus();
      },
    })),
    []
  );

  const row = useViewport() !== "phone";
  return (
    <div
      className={cn(
        // The stepper's thumb and items stack with z-index; `isolate` keeps
        // them inside the row, so they never rise over a window opened above
        // the work area (the wallet, z-index 1), which the full-width row
        // reaches
        "isolate flex min-w-0 shrink-0 items-center justify-center bg-transparent font-sans",
        // In the frame, a 38 px row with the columns' bottom line, as the
        // prototype draws the stage tabs; on a phone, across the preview
        // page's bar
        row ? "h-[38px] border-b border-border px-2" : "flex-1"
      )}
    >
      <Stepper
        state={state}
        onSelect={PgFlow.setStage}
        target={target}
        fill={row}
        phone={!row}
      />
    </div>
  );
};

export default StageBar;
