import type { FC } from "react";
import styled, { css } from "styled-components";

import { primaryLabel } from "./band-copy";
import { foldRecord, legal } from "./ledger";
import { PgLesson } from "./store";
import type { LessonState } from "./store";

interface StepRailProps {
  state: LessonState;
}

/**
 * The lesson's steps, marked with what actually confirmed them.
 *
 * An honest map: rows at legal positions navigate (clicking one is
 * pure navigation, and the model proves it), rows beyond the frontier
 * do not and say why. Nothing is "locked" -- some things are unproved.
 */
const StepRail: FC<React.PropsWithChildren<StepRailProps>> = ({ state }) => {
  const { path } = state;
  if (!path) return null;

  const view = foldRecord(path, state.record);

  return (
    <List>
      {path.steps.map((step, i) => {
        const mark = view.marks.get(step.id) ?? "open";
        const isCurrent = view.cursor === i;
        const atFrontier = view.frontier === i;
        const status: Status = mark !== "open" ? mark : "open";
        const canGo = !isCurrent && legal(path, view, i);

        return (
          <Row
            key={step.id}
            type="button"
            disabled={!canGo}
            $status={status}
            $current={isCurrent}
            $ahead={mark === "open" && !atFrontier}
            title={
              canGo
                ? "Go to this step. Nothing is recorded either way."
                : isCurrent
                ? "You are here"
                : "Not reached -- the steps before it are still open"
            }
            onClick={() => PgLesson.move(step.id)}
          >
            <Glyph $status={status} $current={isCurrent} aria-hidden>
              {mark === "proved" || mark === "attested" ? (
                <>&#10003;</>
              ) : mark === "passed" ? (
                <>&#8594;</>
              ) : isCurrent ? (
                <>&#9679;</>
              ) : (
                <>&#9675;</>
              )}
            </Glyph>
            <Text>
              <Objective>{step.objective}</Objective>
              <Meta>
                {mark === "proved"
                  ? step.verifiedBy
                  : mark === "attested"
                  ? "you marked this read — not machine-checked"
                  : mark === "passed"
                  ? "skipped — not verified"
                  : atFrontier
                  ? primaryLabel(step.verify).toLowerCase()
                  : "not reached"}
              </Meta>
            </Text>
          </Row>
        );
      })}
    </List>
  );
};

export default StepRail;

type Status = "proved" | "attested" | "passed" | "open";

const List = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const Row = styled.button<{
  $status: Status;
  $current: boolean;
  $ahead: boolean;
}>`
  ${({ theme, $current, $ahead, $status }) => css`
    display: grid;
    grid-template-columns: 1rem 1fr;
    gap: 0.5rem;
    align-items: start;
    padding: 0.5rem;
    border: 1px solid ${$current ? theme.colors.default.primary : "transparent"};
    border-radius: ${theme.default.borderRadius};
    background: ${$current ? theme.colors.default.bgSecondary : "transparent"};
    /* A passed row reads as passed-over, never as finished; a row not
       yet reached recedes without claiming to be shut */
    opacity: ${$ahead ? 0.5 : $status === "passed" ? 0.7 : 1};
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:disabled {
      cursor: default;
    }

    &:not(:disabled):hover {
      border-color: ${theme.colors.default.primary};
    }

    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: -2px;
    }
  `}
`;

const Glyph = styled.span<{ $status: Status; $current: boolean }>`
  ${({ theme, $status, $current }) => css`
    color: ${$status === "proved"
      ? theme.colors.default.secondary
      : $current
      ? theme.colors.default.primary
      : theme.colors.default.textSecondary};
  `}
`;

const Text = styled.span`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
`;

const Objective = styled.span`
  color: ${({ theme }) => theme.colors.default.textPrimary};
`;

const Meta = styled.span`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;
