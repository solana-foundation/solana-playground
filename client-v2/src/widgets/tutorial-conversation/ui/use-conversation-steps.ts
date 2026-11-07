/* eslint-disable unicorn/no-null -- the step bar's live index is null before Start, as `liveStepIndex` returns it */
import type { StepBarItem } from "@/features/tutorial-conversation";
import { PgConversation } from "@/features/tutorial-conversation";
import { PgExplorer } from "@/utils/explorer";

import { requestStepJump } from "../model/jump";
import { liveStepIndex } from "../model/step-bar";
import { useConversationState } from "./TutorialConversation";

/** A step as the phone's steps sheet lists it: the bar's item and its objective */
export type PhoneStep = StepBarItem & { objective: string };

export interface ConversationSteps {
  steps: PhoneStep[];
  /** The live step's index (`liveStepIndex`), null before Start */
  live: number | null;
  started: boolean;
  /** Every step passed: the header reads "Done · n of n" */
  finished: boolean;
  /** How many times the assistant wrote code, for Code's dot */
  wrote: number;
  /** The conversation has loaded; before, every count reads 0 */
  loaded: boolean;
  /** The tutorial's estimate, for "{n} steps · {m} min" before Start */
  minutes: number;
  /** Brings step `index`'s heading into view in the feed */
  jump: (index: number) => void;
}

const NONE: ConversationSteps = {
  steps: [],
  live: null,
  started: false,
  finished: false,
  wrote: 0,
  loaded: false,
  minutes: 0,
  jump: requestStepJump,
};

/**
 * What the phone's header needs from the conversation: the steps with their
 * objectives, where the learner is, and how many times the assistant wrote.
 * The feed draws no step bar on the phone, so a step picked in the header's
 * sheet reaches it through `requestStepJump`.
 */
export const useConversationSteps = (): ConversationSteps => {
  const state = useConversationState();
  const context = state.context;
  const view = PgConversation.view();
  // The store keeps the last tutorial's conversation until the next one's
  // save is read: its counts belong to another tutorial, so Code's dot would
  // take the next one's restored writes as new
  if (
    !context ||
    !view ||
    context.definition.name !== PgExplorer.currentWorkspaceName
  ) {
    return NONE;
  }
  const objectives = new Map(
    context.definition.steps.map((step) => [step.id, step.objective])
  );
  const steps = view.steps.map((step) => ({
    ...step,
    objective: objectives.get(step.id) ?? "",
  }));
  return {
    steps,
    live: liveStepIndex(steps),
    started: state.engine.progress.startedAt !== null,
    finished: steps.length > 0 && steps.every((s) => s.state === "done"),
    wrote: view.turns.filter((t) => t.kind === "wrote").length,
    loaded: true,
    minutes: context.definition.minutes,
    jump: requestStepJump,
  };
};
