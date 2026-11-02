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
};

/**
 * Also the conversation engine's tracker (`features/tutorial-conversation`):
 * the spec names its events `tutorial_*`, and the prefix is this slice's.
 */
export const tutorialTelemetry = createTracker<TutorialEvents>();
