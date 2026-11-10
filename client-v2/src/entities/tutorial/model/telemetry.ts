import { createTracker } from "@/shared/lib/telemetry";

/**
 * How a question resolved: a right pick first time or after wrong ones, its
 * key line typed by hand, skipped (its button, or its step passed by a client
 * run), or skipped by a Call panel call that passed its step. The record's
 * qualifier and `tutorial_question_answered` both read it.
 */
export type QuestionResult =
  | "first_try"
  | "retry"
  | "typed"
  | "skipped"
  | "call_panel";

/**
 * The live actions a composer message can name on its own; `word` in
 * `tutorial_word_sent`, and the engine's `Word`
 */
export type ActionWord =
  | "start"
  | "build"
  | "deploy"
  | "run"
  | "call"
  | "next"
  | "explain";

/** How the feed moved to a step's divider: a bar segment, its narrow menu, or ⌥↑ / ⌥↓ */
export type StepJumpVia = "bar" | "menu" | "key";

export type TutorialEvents = {
  /**
   * The loader dropped a tutorial definition that failed its check, so the
   * catalog does not list it. Fires once per definition per page load.
   */
  tutorial_definition_rejected: { tutorial: string; errors: number };
  /**
   * Opening a conversation tutorial created its workspace, so its intro card
   * showed beside the finished program. Fires once per workspace: opening it
   * again, or coming back to the intro through Start over, does not. Start
   * itself is `tutorial_started`. `tutorial` is the slug.
   */
  tutorial_opened: { tutorial: string };
  /**
   * The engine's `start` action: the intro card's Start, or a start word
   * typed in the composer ("start", "begin", "go"). Fires once per start; Start
   * over then Start fires it again. `tutorial` is the slug.
   */
  tutorial_started: { tutorial: string };
  /**
   * The finish card of a conversation tutorial showed, after the last step's
   * win. `seconds` is the time from Start.
   */
  tutorial_finished: { tutorial: string; seconds: number };
  /**
   * A question left open: the right pick, Skip, its key line typed by hand,
   * or its step passed elsewhere (`call_panel` from the Call panel, `skipped`
   * from a client run). `question` is the beat id; `attempts` (1 to 3) is
   * the picks for a pick, else the wrong picks before it plus one. Fires each
   * time a question leaves open; a wrong pick or a hint sends nothing. Start
   * over and a step's Reset open it again, so a re-answer counts again. The
   * question's text is never sent.
   */
  tutorial_question_answered: {
    tutorial: string;
    question: string;
    result: QuestionResult;
    attempts: number;
  };
  /**
   * "Next: <tutorial>" on the finish card opened the tutorial the definition
   * names next; sent once the open resolved, so a failed one is not counted.
   * `tutorial` is the one finished, `next` the one opened, both slugs.
   */
  tutorial_next_opened: { tutorial: string; next: string };
  /**
   * Copy receipt on the finish card's "Transaction details" was pressed; a
   * copy the clipboard refuses is reported apart, as a button failure.
   */
  tutorial_receipt_copied: { tutorial: string };
  /**
   * A step's goal passed on a real result. `via` is how: `chat` (an act
   * card), `client` (a client run) or `call_panel`. `step` is 1-based;
   * `seconds` is whole seconds from entering the step to its pass, time away
   * from the tab included. A passed step stays passed, so this fires once
   * per step until Start over. `reason` is `exists` when the step passed
   * because the account its goal creates already existed, and absent on any
   * other pass.
   */
  tutorial_step_passed: {
    tutorial: string;
    step: number;
    via: "chat" | "client" | "call_panel";
    seconds: number;
    reason?: "exists";
  };
  /**
   * Reset on an appended wrote card put the live step back as it was
   * entered: its start files, its beats played again. `step` is 1-based.
   */
  tutorial_step_reset: { tutorial: string; step: number };
  /**
   * The feed moved to a step's divider: a step bar segment, an item of the
   * bar's narrow menu, or ⌥↑ / ⌥↓. `step` is the divider's step and `from`
   * the live step, both 1-based. Not sent for the back pill, which sends
   * `tutorial_step_back`.
   */
  tutorial_step_jumped: {
    tutorial: string;
    step: number;
    from: number;
    via: StepJumpVia;
  };
  /**
   * The back pill took the learner back to the live card, after a jump to
   * another step or a scroll away from the card. `step` is the live step, or
   * 0 before Start.
   */
  tutorial_step_back: { tutorial: string; step: number };
  /**
   * A composer message reached the live assistant (`typed`; not one that
   * opened Connect a model or waited for an answer), or a finish chip
   * was pressed (`chip`), whose answer needs no model. `step` is 1-based, 0
   * before Start and the last step after the finish. The text is never sent.
   */
  tutorial_question_asked: {
    tutorial: string;
    step: number;
    source: "typed" | "chip";
  };
  /**
   * A message typed in the composer was only an action word ("build",
   * "deploy please", "start"): it ran that action, or, while a question was
   * open, was refused (`refused`); a word with nothing live to run goes to
   * the assistant as a question. `word` is the action word it matched,
   * whatever the case, "please" or punctuation ("begin" and "go" send
   * `start`), never the message itself. `step` is as in
   * `tutorial_question_asked`.
   */
  tutorial_word_sent: {
    tutorial: string;
    step: number;
    word: ActionWord;
    refused: boolean;
  };
  /**
   * "Apply to <file>" on the assistant's apply card wrote its line. `file`
   * is the workspace path. A write that failed sends nothing.
   */
  tutorial_change_applied: { tutorial: string; file: string };
  /** "Keep it" on the assistant's apply card left the file as it was */
  tutorial_change_kept: { tutorial: string };
  /**
   * An act or a Call panel call ended, or a reload interrupted one; the
   * engine fires it from its reducer. `action` is `airdrop`, `build`,
   * `deploy`, `build_deploy`, `run`, `call` (the call act) or `call_panel`.
   * `outcome` is `ok`, `failed`, `interrupted`, `no_wallet`, `no_funds` (an
   * airdrop the faucet refused or that never reached the wallet, or a deploy
   * that found the wallet short) or `unconfirmed` (a run or call sent, and
   * not read back from devnet). `step` is
   * 1-based. `seconds` is the run's whole seconds: from the press to the
   * result, from the press to the block for a deploy recognised after a
   * reload, and 0 for an interrupted run, whose length is not known.
   */
  tutorial_action_run: {
    tutorial: string;
    step: number;
    action:
      | "airdrop"
      | "build"
      | "deploy"
      | "build_deploy"
      | "run"
      | "call"
      | "call_panel";
    outcome:
      | "ok"
      | "failed"
      | "interrupted"
      | "no_wallet"
      | "no_funds"
      | "unconfirmed";
    seconds: number;
  };
};

/**
 * Also the tracker of the conversation engine
 * (`features/tutorial-conversation`) and of its feed
 * (`widgets/tutorial-conversation`): the spec names their events
 * `tutorial_*`, and the prefix is this slice's.
 */
/**
 * Free text, opted in: no type lists the values, so the owner decides
 * whether to keep each (HOO-2752). Slugs and beat ids come from each
 * `tutorial.json`, which the loader reads as data, as `string`.
 */
type TutorialFreeText = {
  tutorial: "a tutorial slug, the folder of a tutorial.json, read at run time";
  next: "the slug of the tutorial a definition names next, a definition's or an upstream Markdown one's";
  question: "a question's beat id from its tutorial.json";
  file: "a workspace path the assistant's apply card wrote";
};

export const tutorialTelemetry = createTracker<
  TutorialEvents,
  TutorialFreeText
>();
