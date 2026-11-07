import type { FC } from "react";
import { useEffect, useState } from "react";

import { PgClientRun, RunButton } from "@/features/docs-link";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";

import { useKeybind } from "../../../hooks";
import type { LessonState } from "../lessons";
import {
  cursorStep,
  foldRecord,
  INITIAL_LESSON_STATE,
  PgLesson,
  targetStage,
} from "../lessons";
import type { FlowState } from "../state/stage";
import { INITIAL_FLOW_STATE, PgFlow, STAGES, stagesOf } from "../state/stage";
import Stepper from "./Stepper";

/**
 * The dev-loop stepper: in the frame, a full-width row of stage tabs under the
 * stage bar, across the files column and the stage (`LayoutShell`'s
 * `stageTabs`, design.md "Frame chrome (5.25)"); on a phone, across the
 * preview page's bar, without Write, which is the code's own page there. It
 * owns the Ctrl+1..4 stage keys and points the stepper at the stage the
 * current lesson step is graded on. A project with no program offers only
 * Write, so the other keys do nothing, and the row labels it "Client
 * project" and carries its Run; on a phone, where Write is the code's own
 * page, it has no stepper at all, only the label and Run. The
 * project list and the session footer live in the navigation (`AppNav`),
 * not here.
 */
const StageBar: FC = () => {
  const [state, setState] = useState<FlowState>(INITIAL_FLOW_STATE);
  useEffect(() => PgFlow.onDidChange(setState).dispose, []);
  // Every run is shown and measured, in a project with a program too
  useEffect(() => PgClientRun.follow(), []);

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
        // A stage the open project does not offer has no tab to go to
        if (!stagesOf(PgFlow.state).includes(stage)) return;
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
        // the work area (the wallet, z-index 30), which the full-width row
        // reaches
        "isolate flex min-w-0 shrink-0 items-center justify-center gap-2 bg-transparent font-sans",
        // In the frame, a 54 px row: the 34 px stepper keeps 8 px from the bar
        // above and 12 px from the editor tabs below, and a client project's
        // badge and Run sit on its centre line. No line under it, so the
        // larger gap and the tabs' own ground set them apart. On a phone,
        // across the preview page's bar
        row ? "h-[3.375rem] px-2 pt-2 pb-3" : "flex-1"
      )}
    >
      <Stepper
        state={state}
        onSelect={PgFlow.setStage}
        target={target}
        fill={row}
        phone={!row}
      />
      {!state.hasProgram && (
        <>
          <Badge variant="outline" id="flow-client-project">
            Client project
          </Badge>
          <RunButton />
        </>
      )}
    </div>
  );
};

export default StageBar;
