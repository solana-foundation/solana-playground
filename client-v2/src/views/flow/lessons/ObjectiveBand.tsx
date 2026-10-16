import type { FC } from "react";
import styled, { css } from "styled-components";

import {
  assistantLabel,
  describeFinish,
  describeStep,
  primaryLabel,
  readLabel,
} from "./band-copy";
import { attempted, foldRecord, nextLegal, prevLegal, rung } from "./ledger";
import { readiness, readinessLine } from "./readiness";
import { remedy } from "./readiness-remedy";
import { PgLesson } from "./store";
import type { LessonState } from "./store";
import { verifyingStage } from "./verify";
import { PgAssistant } from "../../sidebar/assistant/store";
import type { FlowState } from "../state/stage";
import { PgSession } from "../../../features/auth";
import {
  useBalance,
  useProgramInfo,
  useRenderOnChange,
  useWallet,
} from "../../../hooks";
import { PgCommand, PgConnection, PgProgramInfo } from "../../../utils";

interface ObjectiveBandProps {
  state: LessonState;
  flow: FlowState;
  onRead: () => void;
  onOpenGallery: () => void;
}

/**
 * One ask, above the editor, always visible.
 *
 * The primary action is the criterion: the control is labelled by what
 * proves the step and dispatches the same command the header stepper
 * does. The assistant sits beside it as a secondary -- the unaided
 * first attempt, bought by layout rather than by a disabled button.
 * The page comes first among the actions, and until it has been opened
 * it is the band's signpost (D34).
 */
const ObjectiveBand: FC<React.PropsWithChildren<ObjectiveBandProps>> = ({
  state,
  flow,
  onRead,
  onOpenGallery,
}) => {
  // What the proving action needs, from the same sources the header's
  // chips read. Subscribed here, before the early return below, so the
  // hooks run on every render.
  const wallet = useWallet();
  const balance = useBalance();
  const cluster = useRenderOnChange(PgConnection.onDidChangeCluster);
  // A built program survives a reload while `PgFlow` does not, so the
  // explainer has to watch it or it will ask for a build that already
  // happened -- and contradict the rail above it
  useProgramInfo();
  useRenderOnChange(PgSession.onDidChange);

  if (!state.path) return null;
  const view = foldRecord(state.path, state.record);
  const canGoBack = prevLegal(state.path, view) !== null;
  const canGoForward = nextLegal(state.path, view) !== null;

  const nav = (
    <>
      <Nav
        type="button"
        disabled={!canGoBack}
        aria-label="Previous step"
        title={
          canGoBack
            ? "Go back a step. Nothing already proved is undone."
            : "There is nothing to go back to"
        }
        onClick={() => PgLesson.moveBack()}
      >
        &#8592;
      </Nav>
      <Nav
        type="button"
        disabled={!canGoForward}
        aria-label="Next step"
        title={
          canGoForward
            ? "Move forward. Nothing is recorded either way."
            : "This is as far as anything proved reaches"
        }
        onClick={() => PgLesson.moveForward()}
      >
        &#8594;
      </Nav>
    </>
  );

  // No step under the cursor means the path is finished: say so, and say
  // where to go. The rail's rows are still legal positions, so the back
  // arrow still works.
  const shown = describeStep(state);
  if (!shown) {
    const finished = describeFinish(state);
    if (!finished) return null;
    return (
      <Wrapper>
        <Text>
          <Eyebrow>{finished.number}</Eyebrow>
          <Objective>{finished.objective}</Objective>
          <VerifiedBy>{finished.verifiedBy}</VerifiedBy>
        </Text>
        <Actions>
          {nav}
          <Secondary type="button" onClick={onOpenGallery}>
            Browse gallery
          </Secondary>
        </Actions>
      </Wrapper>
    );
  }

  const { step } = shown;
  const spent = rung(view, step.id);
  // Wherever the proving action is offered -- which includes a step the
  // learner skipped and came back to. That is the repair edge the skip
  // valve promised, and the one place they have already said they were
  // stuck, so it is the last place to withhold the explanation.
  const explainer = shown.offersPrimary
    ? readinessLine(
        step.verify,
        readiness(step.verify, {
          build: flow.build,
          // The same expression `checkProgram` uses in the deploy
          // command, so the explainer asks what the command asks
          built:
            !!PgProgramInfo.uuid ||
            !!PgProgramInfo.importedProgram?.bytes.length,
          lastBuildFailed: !!PgProgramInfo.lastBuildFailed,
          wallet: !!wallet,
          balance: typeof balance === "number" ? balance : null,
          cluster: cluster ?? null,
          signedIn: !!PgSession.get(),
        })
      )
    : null;
  const tried = attempted(state.path, view, step.id);

  const askForHelp = () => {
    const prompt = PgLesson.requestHint();
    if (prompt) PgAssistant.requestPrompt(prompt);
  };

  const prove = () => {
    const stage = verifyingStage(step.verify);
    if (stage) PgCommand[stage].execute();
    else PgLesson.attest();
  };

  return (
    <Wrapper>
      <Text>
        <Eyebrow>{shown.number}</Eyebrow>
        <Objective>{shown.objective}</Objective>
        <VerifiedBy>{shown.verifiedBy}</VerifiedBy>
        {/* Only where the proving action is offered: behind the frontier
            there is nothing to be ready for. `aria-live` because the
            list shrinks as the learner fixes things, and a change
            nobody is looking at is a change nobody hears. */}
        {explainer && (
          <Readiness aria-live="polite">
            <Lead>{explainer.lead}</Lead>
            {explainer.items.map((item) =>
              item.actionable ? (
                <Remedy
                  key={item.blocker.kind}
                  type="button"
                  onClick={remedy(item.blocker)}
                >
                  {item.text}
                </Remedy>
              ) : (
                // Nothing to click: a build already running is a thing
                // to wait for, and a second one would only queue behind it
                <Waiting key={item.blocker.kind}>{item.text}</Waiting>
              )
            )}
          </Readiness>
        )}
      </Text>
      <Actions>
        {nav}
        {/* First among the actions on purpose: reading comes before
            proving, and until the page has been opened this is the one
            control that says "read first" */}
        {step.readPage && (
          <Secondary type="button" $unread={!shown.opened} onClick={onRead}>
            {!shown.opened && <Dot aria-hidden />}
            {readLabel(shown.position, shown.opened)}
          </Secondary>
        )}
        <Secondary type="button" onClick={askForHelp}>
          {assistantLabel(spent, tried)}
        </Secondary>
        {shown.offersPrimary && (
          <Primary type="button" onClick={prove}>
            {primaryLabel(step.verify)}
          </Primary>
        )}
      </Actions>
    </Wrapper>
  );
};

export default ObjectiveBand;

const Wrapper = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin: 0.5rem;
    padding: 0.75rem 0.875rem;
    border: 1px solid ${theme.colors.default.primary};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgSecondary};
  `}
`;

// One wrapping unit: narrow enough and the whole group drops under the text
// together, rather than the band shedding one button at a time
const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-left: auto;
`;

// Joins the actions on the right so the objective text stays flush left, but
// stays a bare circle: it moves you between steps rather than acting on one
const Nav = styled.button`
  ${({ theme }) => css`
    flex-shrink: 0;
    width: 1.75rem;
    height: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid ${theme.colors.default.border};
    border-radius: 9999px;
    background: transparent;
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    cursor: pointer;

    &:disabled {
      opacity: 0.35;
      cursor: default;
    }

    &:not(:disabled):hover {
      border-color: ${theme.colors.default.primary};
      color: ${theme.colors.default.textPrimary};
    }

    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }
  `}
`;

const Text = styled.div`
  flex: 1;
  min-width: 14rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
`;

const Eyebrow = styled.span`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.small};
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Objective = styled.span`
  color: ${({ theme }) => theme.colors.default.textPrimary};
  font-weight: 600;
`;

const VerifiedBy = styled.span`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;

// The explainer: a lead and the remedies as inline link-buttons, one
// line, wrapping. Reads as a sentence, acts as a row of controls.
const Readiness = styled.div`
  ${({ theme }) => css`
    margin-top: 0.25rem;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.625rem;
    font-size: ${theme.font.other.size.small};
  `}
`;

const Lead = styled.span`
  color: ${({ theme }) => theme.colors.default.textPrimary};
`;

// A blocker with nothing to act on, in the sub-line's own quiet colour
// so it never reads as a control that failed to respond
const Waiting = styled.span`
  color: ${({ theme }) => theme.colors.default.textSecondary};
`;

const Remedy = styled.button`
  ${({ theme }) => css`
    padding: 0;
    border: none;
    background: transparent;
    color: ${theme.colors.default.primary};
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.15em;
    cursor: pointer;

    &:hover {
      color: ${theme.colors.default.textPrimary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
      border-radius: 2px;
    }
  `}
`;

// `$unread` is the signpost: the primary colour on the border, never a
// filled background -- the filled primary stays the criterion's alone
const Secondary = styled.button<{ $unread?: boolean }>`
  ${({ theme, $unread }) => css`
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    border: 1px solid
      ${$unread ? theme.colors.default.primary : theme.colors.default.border};
    border-radius: 9999px;
    background: transparent;
    color: ${theme.colors.default.textPrimary};
    font: inherit;
    cursor: pointer;

    &:hover {
      border-color: ${theme.colors.default.primary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }
  `}
`;

// The unread marker: one dot in the primary colour, nothing that could
// be mistaken for a badge count
const Dot = styled.span`
  ${({ theme }) => css`
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: ${theme.colors.default.primary};
  `}
`;

const Primary = styled(Secondary)`
  ${({ theme }) => css`
    border-color: transparent;
    background: ${theme.colors.default.primary};
    color: ${theme.colors.default.textPrimary};
  `}
`;
