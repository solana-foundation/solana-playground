import { createTracker } from "@/shared/lib/telemetry";

type TutorialEvents = {
  /**
   * The loader dropped a tutorial definition that failed its check, so the
   * catalog does not list it. Fires once per definition per page load.
   */
  tutorial_definition_rejected: { tutorial: string; errors: number };
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
};

/**
 * Also the conversation engine's tracker (`features/tutorial-conversation`):
 * the spec names its events `tutorial_*`, and the prefix is this slice's.
 */
export const tutorialTelemetry = createTracker<TutorialEvents>();
