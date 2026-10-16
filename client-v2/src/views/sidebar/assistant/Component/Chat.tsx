import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import { Empty, EmptyDescription } from "@/shared/ui/empty";
import ChatItem from "./ChatItem";
import { ThreeDots } from "../../../../components/Loading/ThreeDots";
import {
  PgAssistant,
  turnAppliedApproval,
  turnProducedApproval,
} from "../store";
import { describeLesson } from "../bridge/lesson-context";
import { PgCommand } from "../../../../utils";
import { useRenderOnChange } from "../../../../hooks";
import {
  attempted,
  cursorStep,
  foldRecord,
  INITIAL_LESSON_STATE,
  PgLesson,
  verifyingStage,
} from "../../../flow/lessons";
import type { LessonState } from "../../../flow/lessons";
import type { Turn } from "../../../../widgets/assistant";

const SUGGESTIONS = [
  "Why did my build fail?",
  "What does this program do?",
  "What's our current status and roadmap?",
];

/**
 * Sent by "Make this change": models often describe an edit in prose instead of
 * calling `write_file`. This asks for the same edit as a patch, which lands in
 * the usual approval card.
 *
 * Phrased to work mid-lesson too, where the assistant is holding back a hint
 * and has described no edit yet — and leaving it a line to say afterwards, so
 * the turn does not end on a silence the panel has to explain.
 */
const MAKE_CHANGE =
  "Write this change for me, using write_file with the complete new content " +
  "of the file — the change you just described, or the one this step needs " +
  "if you have not described one yet. If it touches more than one file, do " +
  "them one at a time. Skip the explanation you would usually give first and " +
  "summarise it in one line afterwards.";

/**
 * The conversation: the thread, its empty state and the thinking dots.
 *
 * The turn itself -- the provider, send, stop, and prompts asked for from
 * outside the panel -- is `useTurn`'s, shared with the composer below; every
 * action here starts a turn through `turn.send`.
 */
const Chat = ({ turn }: { turn: Turn }) => {
  useRenderOnChange(PgAssistant.onDidChange);

  const bottomRef = useRef<HTMLDivElement>(null);

  const items = PgAssistant.items;
  const status = PgAssistant.status;
  const { busy, send } = turn;

  // Follow the conversation as it grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items.length, status]);

  const [lessonState, setLessonState] =
    useState<LessonState>(INITIAL_LESSON_STATE);
  useEffect(() => PgLesson.onDidChange(setLessonState).dispose, []);

  const lesson = describeLesson(lessonState);

  // Offer "Make this change" on the reply the assistant just finished, and
  // only there: an older message describes code that has since moved on, and a
  // turn ending in an approval card has already produced its patch.
  const lastItem = items[items.length - 1];
  const wroteThisTurn = turnProducedApproval(items);
  const changeableId =
    !busy && lastItem?.kind === "assistant" && lastItem.text && !wroteThisTurn
      ? lastItem.id
      : null;

  /**
   * The two mid-lesson actions on a finished reply, offered one at a time so
   * the reply always names the single next move:
   *
   * - the patch has landed but no build has run yet: the move is that build,
   *   which is also the only thing that can prove the step. This is the CTA
   *   the reply used to end on, except it pointed at the next step instead of
   *   at the action, so taking it skipped the step it was meant to finish.
   * - a build has run and the step is still unverified: the learner may be
   *   right and the grader wrong, so the escape valve appears. Nothing here
   *   proves anything, so it stays labelled as the skip it records.
   */
  const onFinishedReply = !busy && lesson && lastItem?.kind === "assistant";
  const view = lessonState.path
    ? foldRecord(lessonState.path, lessonState.record)
    : null;
  const step = lessonState.path && view && cursorStep(lessonState.path, view);
  const stage = step && verifyingStage(step.verify);
  const stepAttempted = !!(
    lessonState.path &&
    view &&
    step &&
    attempted(lessonState.path, view, step.id)
  );

  const verifiableId =
    onFinishedReply && !stepAttempted && stage && turnAppliedApproval(items)
      ? lastItem.id
      : null;

  // The chat's skip card is the same edge as the rail's pinned valve,
  // so it is offered under the same precondition and nowhere else
  const skippableId =
    onFinishedReply && stepAttempted && PgLesson.canPass() ? lastItem.id : null;

  // Cover the silent gaps: before the first token and while tools run.
  // Once text streams into the last assistant item the dots come down.
  const thinking =
    status === "running" && (lastItem?.kind !== "assistant" || !lastItem.text);

  return (
    <Wrapper>
      <Messages role="log" aria-label="Conversation">
        {items.length === 0 ? (
          <Empty className="items-stretch justify-start gap-2 p-0 text-left">
            <EmptyDescription className="pb-1 tracking-widest">
              TRY ASKING
            </EmptyDescription>
            {SUGGESTIONS.map((suggestion) => (
              <Suggestion key={suggestion} onClick={() => send(suggestion)}>
                {suggestion}
              </Suggestion>
            ))}
          </Empty>
        ) : (
          items.map((item) => (
            <ChatItem
              key={item.id}
              item={item}
              onMakeChange={
                item.id === changeableId ? () => send(MAKE_CHANGE) : undefined
              }
              // Inside a lesson the same click skips the hint ladder, so it is
              // offered as a way out rather than as the obvious next step
              makeChangeIsLastResort={!!lesson}
              onVerifyStep={
                item.id === verifiableId
                  ? () => PgCommand[stage!].execute()
                  : undefined
              }
              verifyStepLabel={stage === "deploy" ? "Deploy" : "Build"}
              verifyStepTitle={
                lesson &&
                `${lesson.verifiedBy} — this is what proves it, and the only thing that can.`
              }
              onSkipStep={
                item.id === skippableId ? () => PgLesson.pass() : undefined
              }
              skipStepTitle={
                lesson &&
                `This step is still not verified — ${lesson.verifiedBy}. Skipping records that you moved past it unproven; you can come back with the arrows.`
              }
            />
          ))
        )}
        {thinking && (
          <Thinking role="status" aria-label="Assistant is working">
            <ThreeDots width="0.25rem" height="0.25rem" distance="0.5rem" />
          </Thinking>
        )}
        <div ref={bottomRef} />
      </Messages>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
`;

const Messages = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
  flex-grow: 1;
  overflow-y: auto;
  padding: 1rem 0.75rem;
  min-height: 0;
`;

const Suggestion = styled.button`
  ${({ theme }) => css`
    text-align: left;
    padding: 0.625rem 0.6875rem;
    background: transparent;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    font-size: ${theme.font.code.size.small};
    line-height: 1.5;
    cursor: pointer;
    transition: all ${theme.default.transition.duration.medium}
      ${theme.default.transition.type};

    &:hover {
      background: ${theme.colors.state.hover.bg};
      color: ${theme.colors.default.textPrimary};
    }

    &:focus-visible {
      outline: 1px solid ${theme.colors.default.primary};
      outline-offset: -1px;
    }
  `}
`;

const Thinking = styled.div`
  /* The outer dots of \`ThreeDots\` are pseudo-elements offset by \`distance\`,
   * so the row needs its own room on the left */
  display: flex;
  align-items: center;
  min-height: 0.75rem;
  padding-left: 0.625rem;
`;

export default Chat;
