import type { FC } from "react";
import { useEffect, useState } from "react";
import styled, { css } from "styled-components";

import ProjectSwitcher from "./ProjectSwitcher";
import StatusChips from "./StatusChips";
import Stepper from "./Stepper";
import {
  cursorStep,
  foldRecord,
  INITIAL_LESSON_STATE,
  PgLesson,
  targetStage,
} from "../lessons";
import type { LessonState } from "../lessons";
import type { SettingsFocus } from "../settings/GearSidebar";
import { INITIAL_FLOW_STATE, PgFlow, STAGES } from "../state/stage";
import type { FlowState } from "../state/stage";
import { GRADIENT } from "../tokens";
import { useKeybind } from "../../../hooks";

interface HeaderProps {
  onOpenGallery: () => void;
  onToggleSettings: (focus?: SettingsFocus) => void;
  settingsOpen: boolean;
}

/**
 * The Flow layout's top bar: project switcher on the left, the dev-loop
 * stepper centered, cluster/wallet/settings on the right.
 */
const Header: FC<React.PropsWithChildren<HeaderProps>> = ({
  onOpenGallery,
  onToggleSettings,
  settingsOpen,
}) => {
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
      <Zone>
        <Logomark aria-hidden="true" />
        <ProjectSwitcher onOpenGallery={onOpenGallery} />
      </Zone>
      <Zone $center>
        <Stepper state={state} onSelect={PgFlow.setStage} target={target} />
      </Zone>
      <Zone $end>
        <StatusChips
          onToggleSettings={onToggleSettings}
          settingsOpen={settingsOpen}
        />
      </Zone>
    </Bar>
  );
};

export default Header;

// Transparent on the black page ground -- the floating panels below carry
// their own edges, so the header needs none of its own.
//
// Raised above the stock Sidebar's container (z-10, absolute in the shell): the switcher's and
// the status chips' menus drop down over the left panel, and beneath it they
// are drawn but cannot be clicked.
const Bar = styled.header`
  ${({ theme }) => css`
    position: relative;
    z-index: 20;
    height: 3.5rem;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0 0.75rem;
    background: transparent;
    font-family: ${theme.font.other.family};
  `}
`;

const Zone = styled.div<{ $center?: boolean; $end?: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  justify-content: ${({ $center, $end }) =>
    $center ? "center" : $end ? "flex-end" : "flex-start"};
`;

const Logomark = styled.div`
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: ${GRADIENT};
`;
