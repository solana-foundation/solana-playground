import type { FC } from "react";
import { useEffect, useState } from "react";
import styled, { css } from "styled-components";

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

/**
 * The dev-loop stepper, centred across the top of the files column and the
 * stage (`LayoutShell`'s `stageBar`). It owns the Ctrl+1..4 stage keys and
 * points the stepper at the stage the current lesson step is graded on. The
 * project switcher and the status chips live in the navigation (`AppNav`),
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

  return (
    <Bar>
      <Stepper state={state} onSelect={PgFlow.setStage} target={target} />
    </Bar>
  );
};

export default StageBar;

// Transparent on the black page ground -- the floating panels below carry
// their own edges, so the bar needs none of its own.
const Bar = styled.div`
  ${({ theme }) => css`
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding-bottom: 0.5rem;
    background: transparent;
    font-family: ${theme.font.other.family};
  `}
`;
