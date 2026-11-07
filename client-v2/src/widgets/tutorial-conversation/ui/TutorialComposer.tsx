/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { useEffect, useState } from "react";

import { PgConversation } from "@/features/tutorial-conversation";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { PgAssistant } from "@/views/sidebar/assistant/store";

import { hasAnswered } from "../model/merge";
import BaseTutorialComposer from "./BaseTutorialComposer";
import { useConversationState } from "./TutorialConversation";

/**
 * The live assistant's turn as the composer needs it: the one `useTurn`
 * (`widgets/assistant`) that `TutorialChat` in `views/flow/Flow.tsx` mounts
 * while the frame shows, described here by shape, since a widget does not
 * import another. Its `send` clears `input` itself, and only once the
 * message is in, so a send it refuses leaves the text in the box.
 */
export interface ComposerTurn {
  /**
   * Send a prompt; with nothing connected, it opens Connect a model and puts
   * the text back. Resolves `true` once the assistant has the message, after
   * its answer, and `false` when it opened Connect a model instead, was
   * refused or failed
   */
  send: (text: string) => Promise<boolean>;
  stop: () => void;
  busy: boolean;
  input: string;
  setInput: (value: string) => void;
}

export interface TutorialComposerProps {
  turn: ComposerTurn;
}

/** Why a question typed while the assistant answers is still in the box */
const HELD =
  "The assistant is still answering. Press Enter again once it's done.";

/**
 * The composer under the feed. A live action's word runs that action and a
 * word the open question refuses gets the lesson's refusal
 * (`PgConversation.say`); anything else goes to the live assistant, counted
 * as asked. A finish chip posts its answer with no model call. The box holds
 * the turn's own input, so a message the assistant could not send yet (no
 * model connected) comes back here.
 */
export const TutorialComposer = ({ turn }: TutorialComposerProps) => {
  const state = useConversationState();
  const [held, setHeld] = useState(false);
  // Below the frame's width, the phone layout's composer
  const phone = useViewport() !== "wide";
  // The answer ended: the question can go now, so the note has done its job
  useEffect(() => {
    if (!turn.busy) setHeld(false);
  }, [turn.busy]);
  const view = PgConversation.view();
  const context = state.context;
  if (!context || !view) return null;

  const progress = state.engine.progress;
  const finished = progress.cursor.kind === "finished";
  const waiting = progress.cursor.kind === "intro";
  // In words or with a tool, since the last Start over: a turn that only
  // opens the menu writes nothing, and the row is what still suggests starting
  const answered =
    waiting &&
    !turn.busy &&
    hasAnswered(PgAssistant.items, progress.restartedAt);
  const send = (text: string) => {
    if (PgConversation.say(text) === "lesson") {
      turn.setInput("");
      return;
    }
    // A question while the assistant answers waits in the box, uncounted,
    // with a note saying so: `useTurn` would refuse it
    if (turn.busy) {
      setHeld(true);
      return;
    }
    // With no model, `send` opens Connect a model and keeps the text here,
    // with no note, as the panel's composer does for a typed message (its
    // "waiting" note is for prompts the product asked for); only a message
    // the assistant got is counted as asked, on the step it was asked on:
    // `send` resolves after the answer, and Start can come during it
    const askedAt = progress.cursor;
    void turn.send(text).then((reached) => {
      if (reached) PgConversation.asked(askedAt);
    });
  };
  return (
    <BaseTutorialComposer
      value={turn.input}
      onChange={turn.setInput}
      placeholder={view.placeholder}
      busy={turn.busy}
      onSend={send}
      onStop={turn.stop}
      chips={
        finished ? context.definition.finish.chips.map((c) => c.label) : null
      }
      onChip={(i) => PgConversation.chip(i)}
      waiting={waiting}
      note={held ? HELD : null}
      // On the phone Start takes the composer's place for the whole intro, not
      // only once the assistant has answered
      onStart={
        answered || (phone && waiting)
          ? () => PgConversation.start()
          : undefined
      }
      phone={phone}
    />
  );
};
