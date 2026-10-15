import type { FC } from "react";
import styled, { css } from "styled-components";

import { STAGES } from "../state/stage";
import type { FlowState, Stage, StageStatus } from "../state/stage";
import { GRADIENT } from "../tokens";

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
 * greyed the connector every time the learner glanced at their own source.
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
  /**
   * The stage the current lesson step is aiming at, drawn as a ring.
   * `null` outside a lesson. Nothing else about the stepper changes:
   * the loop stays a loop, and this only says where the lesson is
   * pointing.
   */
  target?: Stage | null;
}

/**
 * The write -> build -> deploy -> interact loop, rendered as a horizontal
 * pill stepper. Each stage's status is carried by dot/glyph shape as well
 * as color, so the sequence reads correctly without color vision.
 */
const Stepper: FC<React.PropsWithChildren<StepperProps>> = ({
  state,
  onSelect,
  target,
}) => (
  <Wrapper role="tablist" aria-label="Development loop">
    {STAGES.map((stage, i) => {
      const status = statusOf(state, stage);
      const selected = state.stage === stage;
      // Spoken only, never rendered: a visible count would widen the pill
      // on failure, and the loop's density must not change with status --
      // the red border and dot already carry "failed". A pre-compiler
      // failure has no count, so saying "0 errors" would mislead.
      const suffix =
        stage === "build" && status === "failed" && state.buildErrorCount > 0
          ? `, ${state.buildErrorCount} error${
              state.buildErrorCount === 1 ? "" : "s"
            }`
          : "";
      return (
        <Item key={stage}>
          {i > 0 && (
            <Connector $done={statusOf(state, STAGES[i - 1]) === "done"} />
          )}
          <StageButton
            id={`flow-stage-tab-${stage}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`flow-stage-panel-${stage}`}
            aria-label={`${LABEL[stage]}: ${status}${suffix}${
              stage === target ? ", current lesson target" : ""
            }`}
            $status={status}
            $selected={selected}
            $target={stage === target}
            onClick={() => onSelect(stage)}
          >
            <Dot $status={status} aria-hidden />
            <Full>{LABEL[stage]}</Full>
            <Initial>{LABEL[stage][0]}</Initial>
          </StageButton>
        </Item>
      );
    })}
  </Wrapper>
);

export default Stepper;

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
`;

const Item = styled.div`
  display: flex;
  align-items: center;
`;

const Connector = styled.span<{ $done: boolean }>`
  ${({ theme, $done }) => css`
    width: 24px;
    height: 1px;
    margin: 0 0.25rem;
    background: ${$done
      ? theme.colors.state.success.color
      : theme.colors.default.border};
  `}
`;

/**
 * `done` renders as a plain checkmark glyph (no fill), everything else as a
 * small circular dot -- the shape difference (check vs. hollow ring vs.
 * filled circle) is what carries the status when color is unavailable.
 */
const Dot: FC<
  React.PropsWithChildren<{ $status: StageStatus; "aria-hidden"?: boolean }>
> = ({ $status, ...rest }) =>
  $status === "done" ? (
    <CheckGlyph viewBox="0 0 14 14" width="14" height="14" {...rest}>
      <path
        d="M3 7.3l2.6 2.6L11 4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </CheckGlyph>
  ) : (
    <DotCircle $status={$status} {...rest} />
  );

const CheckGlyph = styled.svg`
  flex-shrink: 0;
  color: ${({ theme }) => theme.colors.state.success.color};
`;

const DotCircle = styled.span<{ $status: StageStatus }>`
  ${({ theme, $status }) => css`
    flex-shrink: 0;
    /* Same 14px box as CheckGlyph, so flipping done <-> other never
       shifts the label */
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      box-sizing: border-box;

      ${$status === "active" || $status === "running"
        ? css`
            /* Gradient policy (GradientButton, docs/design/brand-research.md):
             the 135deg brand gradient marks the active stage's dot. */
            background: ${GRADIENT};
          `
        : $status === "failed"
        ? css`
            background: ${theme.colors.state.error.color};
          `
        : css`
            background: transparent;
            border: 1px solid ${theme.colors.default.textSecondary};
          `}
    }

    ${$status === "running" &&
    css`
      &::before {
        animation: stepper-pulse 1.2s ease-in-out infinite;
      }

      @keyframes stepper-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.45;
          transform: scale(1.15);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        &::before {
          animation: none;
        }
      }
    `}
  `}
`;

/**
 * Below `STEPPER_COMPACT_AT` the four labels collapse to their initials, which
 * is what stops the status chips overlapping the stepper on a narrow window.
 * The full name stays in each button's `aria-label` either way, so nothing is
 * lost to a screen reader.
 */
const STEPPER_COMPACT_AT = "80rem";

const Full = styled.span`
  @media (max-width: ${STEPPER_COMPACT_AT}) {
    display: none;
  }
`;

const Initial = styled.span`
  display: none;

  @media (max-width: ${STEPPER_COMPACT_AT}) {
    display: inline;
  }
`;

const StageButton = styled.button<{
  $status: StageStatus;
  $selected: boolean;
  $target: boolean;
}>`
  ${({ theme, $status, $selected, $target }) => css`
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 6px 14px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: ${$selected ||
    $status === "active" ||
    $status === "running" ||
    $status === "failed"
      ? theme.components.tooltip.bg
      : "transparent"};
    /* Selection and status are separate axes: an upcoming stage you have
       selected still reads as the one you are on, or it renders dimmer than
       the stages you are not looking at. The dot still carries the status. */
    color: ${$selected || $status !== "upcoming"
      ? theme.colors.default.textPrimary
      : theme.colors.default.textSecondary};
    font: inherit;
    font-family: ${theme.font.other.family};
    font-size: ${theme.font.other.size.small};
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease;

    /* Dashed, and no glow: the focus ring is a solid outline in the same
       colour, so shape is what tells "the lesson points here" apart from
       "your keyboard is here". */
    ${$target &&
    css`
      border-style: dashed;
      border-color: ${theme.colors.default.primary};
    `}

    ${$status === "failed" &&
    css`
      border-color: ${theme.colors.state.error.color};
    `}

    &:hover {
      background: ${theme.colors.default.bgSecondary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;
