import { useEffect, useState } from "react";

import { useRenderOnChange } from "../../../hooks/useRenderOnChange";
import { PgCommand } from "../../../utils/command";
import { describeLesson } from "../../../views/sidebar/assistant/bridge/lesson-context";
import {
  PgAssistant,
  turnAppliedApproval,
  turnProducedApproval,
} from "../../../views/sidebar/assistant/store";
import {
  attempted,
  cursorStep,
  foldRecord,
  INITIAL_LESSON_STATE,
  PgLesson,
  verifyingStage,
} from "../../../views/flow/lessons";
import type { LessonState } from "../../../views/flow/lessons";
import { assistantTelemetry } from "../model/telemetry";
import type { Turn } from "../model/use-turn";
import { BaseThread } from "./BaseThread";
import type { ApprovalAnswer } from "./BaseApprovalCard";
import type { ReplyActions } from "./BaseThreadItem";

/** The empty thread's first questions: the step's inside a lesson, as the
 * prototype offers them, the project's elsewhere */
const SUGGESTIONS = {
  lesson: ["Explain this step", "Give me a hint", "Why did my build fail?"],
  project: [
    "What does this program do?",
    "Why did my build fail?",
    "How do I deploy this?",
  ],
} as const;

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
 * The conversation, connected: the store's items, the lesson's next move and
 * the turn's `send`, which the composer below shares.
 */
export const Thread = ({
  turn,
  project,
}: {
  turn: Turn;
  project: string | null;
}) => {
  useRenderOnChange(PgAssistant.onDidChange);

  const [lessonState, setLessonState] =
    useState<LessonState>(INITIAL_LESSON_STATE);
  useEffect(() => PgLesson.onDidChange(setLessonState).dispose, []);

  const items = PgAssistant.items;
  const status = PgAssistant.status;
  const { busy } = turn;
  const lesson = describeLesson(lessonState);

  // `useTurn`'s send settles on its own: a failed turn lands in the thread,
  // and a send that fails before its turn starts goes to `reportButtonFailure`
  const send = (text: string) => void turn.send(text);

  // Offer "Make this change" on the reply the assistant just finished, and
  // only there: an older message describes code that has since moved on, and a
  // turn ending in an approval card has already produced its patch.
  const lastItem = items[items.length - 1];
  const changeableId =
    !busy &&
    lastItem?.kind === "assistant" &&
    lastItem.text &&
    !turnProducedApproval(items)
      ? lastItem.id
      : null;

  /**
   * The two mid-lesson actions on a finished reply, offered one at a time so
   * the reply always names the single next move:
   *
   * - the patch has landed but no build has run yet: the move is that build,
   *   which is also the only thing that can prove the step.
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
  // "Skip this step" is the same edge as the rail's pinned valve,
  // so it is offered under the same precondition and nowhere else
  const skippableId =
    onFinishedReply && stepAttempted && PgLesson.canPass() ? lastItem.id : null;

  const actionsFor = (id: string): ReplyActions | undefined => {
    const actions: ReplyActions = {};
    if (id === changeableId) {
      actions.makeChange = {
        mode: lesson ? "lastResort" : "next",
        onClick: () => {
          assistantTelemetry.track("assistant_make_change_requested", {});
          send(MAKE_CHANGE);
        },
      };
    }
    // Both lesson moves are offered only on a finished reply inside a lesson
    if (lesson && stage && id === verifiableId) {
      actions.verifyStep = {
        stage,
        title: `${lesson.verifiedBy} — this is what proves it, and the only thing that can.`,
        onClick: () => PgCommand[stage].execute(),
      };
    }
    if (lesson && id === skippableId) {
      actions.skipStep = {
        title: `This step is still not verified — ${lesson.verifiedBy}. Skipping records that you moved past it unproven; you can come back with the arrows.`,
        onClick: () => PgLesson.pass(),
      };
    }
    return Object.keys(actions).length ? actions : undefined;
  };

  // Read from the store, not from what was rendered: a second tap lands
  // before the re-render, and only a card still pending is an answer
  const onAnswer = (id: string, answer: ApprovalAnswer) => {
    const card = PgAssistant.items.find((item) => item.id === id);
    if (card?.kind !== "approval" || card.status !== "pending") return;
    assistantTelemetry.track("assistant_approval_answered", {
      kind: card.request.type,
      answer,
    });
    PgAssistant.resolveApproval(id, answer === "allow");
  };

  // Cover the silent gaps: before the first token and while tools run.
  // Once text streams into the last assistant item the marker comes down.
  const working =
    status === "running" && (lastItem?.kind !== "assistant" || !lastItem.text);

  return (
    <BaseThread
      items={items}
      working={working}
      // From state, not a stored item: it must survive a render reset
      // (`clear`) and must never be saved or synced with the thread
      unsaved={PgAssistant.unsaved}
      project={project}
      suggestions={lesson ? SUGGESTIONS.lesson : SUGGESTIONS.project}
      onSuggestion={(text) => {
        assistantTelemetry.track("assistant_suggestion_picked", {});
        send(text);
      }}
      actionsFor={actionsFor}
      onAnswer={onAnswer}
      retry={
        turn.retry
          ? {
              secondsLeft: turn.retry.secondsLeft,
              canTryNow: turn.retry.canTryNow,
              onTryNow: turn.tryNow,
              onStop: turn.stop,
            }
          : undefined
      }
    />
  );
};
