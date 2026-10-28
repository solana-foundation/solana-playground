import type { FC } from "react";
import { useEffect, useState } from "react";
import styled, { css } from "styled-components";

import { Badge } from "@/shared/ui/badge";

import Stepper from "./Stepper";
import {
  cursorStep,
  foldRecord,
  INITIAL_LESSON_STATE,
  PgLesson,
  targetStage,
} from "../lessons";
import type { LessonState } from "../lessons";
import { INITIAL_FLOW_STATE, PgFlow, STAGES, stagesOf } from "../state/stage";
import type { FlowState } from "../state/stage";
import { useKeybind } from "../../../hooks";
import { useViewport } from "@/shared/lib/hooks/use-viewport";

/**
 * The dev-loop stepper: in the frame, a full-width row of stage tabs under the
 * stage bar, across the files column and the stage (`LayoutShell`'s
 * `stageTabs`, design.md "Frame chrome (5.25)"); on a phone, in the preview
 * page's bar, where it keeps its own width. It owns the Ctrl+1..4 stage keys and
 * points the stepper at the stage the current lesson step is graded on. A
 * project with no program offers only Write, so the other keys do nothing,
 * and the row labels it "Client project". The
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
    <Bar $row={row}>
      <Stepper
        state={state}
        onSelect={PgFlow.setStage}
        target={target}
        fill={row}
      />
      {!state.hasProgram && (
        <Badge variant="outline" id="flow-client-project">
          Client project
        </Badge>
      )}
    </Bar>
  );
};

export default StageBar;

// In the frame, a 38 px row with the columns' bottom line, as the prototype
// draws the stage tabs; on a phone, centred in the preview page's bar
const Bar = styled.div<{ $row: boolean }>`
  ${({ theme, $row }) => css`
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-width: 0;
    background: transparent;
    font-family: ${theme.font.other.family};
    /* The stepper's thumb and items stack with z-index; kept inside the row,
       so they never rise over a window opened above the work area (the
       wallet, z-index 1), which the full-width row reaches */
    isolation: isolate;
    ${$row
      ? css`
          height: 38px;
          padding: 0 0.5rem;
          border-bottom: 1px solid ${theme.colors.default.border};
        `
      : css`
          padding-bottom: 0.5rem;
        `}
  `}
`;
