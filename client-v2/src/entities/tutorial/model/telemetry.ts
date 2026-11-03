import { createTracker } from "@/shared/lib/telemetry";

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
   * The engine's `start` action: the intro card's Start, or, once the
   * composer lands (task 3.6), a start word. Fires once per start; Start
   * over then Start fires it again. `tutorial` is the slug.
   */
  tutorial_started: { tutorial: string };
  /**
   * The finish card of a conversation tutorial showed, after the last step's
   * win. `seconds` is the time from Start.
   */
  tutorial_finished: { tutorial: string; seconds: number };
  /**
   * A step's goal passed on a real result. `via` is how: `chat` (an act
   * card), `client` (a client run) or `call_panel`. `step` is 1-based;
   * `seconds` is whole seconds from entering the step to its pass, time away
   * from the tab included. A passed step stays passed, so this fires once
   * per step until Start over.
   */
  tutorial_step_passed: {
    tutorial: string;
    step: number;
    via: "chat" | "client" | "call_panel";
    seconds: number;
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
   * An act or a Call panel call ended, or a reload interrupted one; the
   * engine fires it from its reducer. `action` is `build`, `deploy`,
   * `build_deploy`, `run`, `call` (the call act) or `call_panel`. `outcome`
   * is `ok`, `failed`, `interrupted`, `no_wallet` or `no_funds` (the deploy's
   * airdrop was refused, failed, or never reached the wallet). `step` is
   * 1-based. `seconds` is the run's whole seconds: from the press to the
   * result, from the press to the block for a deploy recognised after a
   * reload, and 0 for an interrupted run, whose length is not known.
   */
  tutorial_action_run: {
    tutorial: string;
    step: number;
    action: "build" | "deploy" | "build_deploy" | "run" | "call" | "call_panel";
    outcome: "ok" | "failed" | "interrupted" | "no_wallet" | "no_funds";
    seconds: number;
  };
};

/**
 * Also the tracker of the conversation engine
 * (`features/tutorial-conversation`) and of its feed
 * (`widgets/tutorial-conversation`): the spec names their events
 * `tutorial_*`, and the prefix is this slice's.
 */
export const tutorialTelemetry = createTracker<TutorialEvents>();
